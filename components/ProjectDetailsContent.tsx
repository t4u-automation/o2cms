"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/hooks/useTenant";
import { EnvironmentProvider, useEnvironment } from "@/contexts/EnvironmentContext";
import { TypesenseProvider } from "@/contexts/TypesenseContext";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  createEnvironment,
  updateEnvironment,
  getEnvironmentContentTypes,
  createContentType,
  updateContentType,
} from "@/lib/firestore";
import Header from "@/components/Header";
import Breadcrumbs from "@/components/Breadcrumbs";
import ProjectSidebar from "@/components/ProjectSidebar";
import ProjectSettingsModal from "@/components/ProjectSettingsModal";
import EnvironmentSelector from "@/components/EnvironmentSelector";
import EnvironmentModal from "@/components/EnvironmentModal";
import ContentTypeModal from "@/components/ContentTypeModal";
import ContentTypeList from "@/components/ContentTypeList";
import ContentTypeDetails from "@/components/ContentTypeDetails";
import EntryList from "@/components/EntryList";
import EntryDetails from "@/components/EntryDetails";
import EntryEditorInline from "@/components/EntryEditorInline";
import MediaLibrary from "@/components/MediaLibrary";
import MediaUploadModal from "@/components/MediaUploadModal";
import Dropdown from "@/components/Dropdown";
import { useToast } from "@/contexts/ToastContext";
import { Project, O2User, Environment, ContentType, Entry, EntryFields, Asset } from "@/types";
import { createEntry, updateEntry, publishEntry, unpublishEntry, archiveEntry, deleteEntry, scheduleEntryAction, cancelScheduledAction } from "@/lib/firestore/entries";
import { createAsset, getEnvironmentAssets, updateAsset, deleteAsset } from "@/lib/firestore/assets";
import { FileText, Plus } from "lucide-react";
import O2Loader from "@/components/O2Loader";

interface ProjectDetailsContentProps {
  projectId: string;
}

type MenuItem = "content-types" | "content" | "media";

function ProjectDetailsInner({ projectId }: ProjectDetailsContentProps) {
  const { environments, selectedEnvironment, setSelectedEnvironment, refreshEnvironments, resetToDefaultEnvironment, initializeEnvironments } = useEnvironment();
  const { user, claims, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading, needsOnboarding } = useTenant(user);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSuccess, showError } = useToast();

  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEnvironmentModal, setShowEnvironmentModal] = useState(false);
  const [editingEnvironment, setEditingEnvironment] = useState<Environment | null>(null);
  const [userRole, setUserRole] = useState<O2User["role"] | null>(null);
  
  // Content Type state
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [selectedContentType, setSelectedContentType] = useState<ContentType | null>(null);
  const [showContentTypeModal, setShowContentTypeModal] = useState(false);
  const [editingContentType, setEditingContentType] = useState<ContentType | null>(null);
  const [loadingContentTypes, setLoadingContentTypes] = useState(false);
  
  // Entry state
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entryContentType, setEntryContentType] = useState<ContentType | null>(null);
  const [isEditingEntry, setIsEditingEntry] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  
  // Media state
  const [showMediaUpload, setShowMediaUpload] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  
  const tabParam = searchParams.get('tab') as MenuItem | null;
  const [activeMenuItem, setActiveMenuItem] = useState<MenuItem>(
    tabParam && ["content-types", "content", "media"].includes(tabParam) ? tabParam : "content-types"
  );

  const combinedLoading = authLoading || tenantLoading;

  useEffect(() => {
    if (!combinedLoading) {
      if (!user) {
        router.push("/login");
      } else if (needsOnboarding) {
        router.push("/");
      }
    }
  }, [user, combinedLoading, needsOnboarding, router]);

  useEffect(() => {
    if (tenant && projectId) {
      loadProject();
      checkUserRole();
      checkAndInitializeEnvironments();
    }
  }, [tenant, projectId]);

  // Load content types when environment changes with real-time listener
  useEffect(() => {
    if (!selectedEnvironment || !tenant) return;

    const unsubscribe = setupContentTypesListener();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [selectedEnvironment, tenant]);
  
  // Load entries when content type or environment changes with real-time listener
  useEffect(() => {
    if (!entryContentType || !selectedEnvironment || !tenant) {
      setEntries([]);
      setSelectedEntry(null);
      return;
    }

    const unsubscribe = setupEntriesListener();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [entryContentType, selectedEnvironment, tenant]);

  const checkAndInitializeEnvironments = async () => {
    if (!tenant || !projectId || !user) return;

    // Check if environments exist for this project
    if (environments.length === 0 && !loading) {
      try {
        await initializeEnvironments(projectId, tenant.id, user.uid);
        showSuccess("Default environment created");
      } catch (error) {
        console.error("[ProjectDetailsContent] Error initializing environments:", error);
      }
    }
  };

  useEffect(() => {
    if (tabParam && tabParam !== activeMenuItem) {
      setActiveMenuItem(tabParam);
    }
  }, [tabParam]);

  // Auto-select first content type when navigating to Content tab
  useEffect(() => {
    if (activeMenuItem === "content" && contentTypes.length > 0 && !entryContentType) {
      setEntryContentType(contentTypes[0]);
    }
  }, [activeMenuItem, contentTypes, entryContentType]);

  const checkUserRole = async () => {
    if (!user) return;

    try {
      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data() as O2User;
        setUserRole(userData.role);
      }
    } catch (error) {
      console.error("[ProjectDetailsContent] Error checking user role:", error);
    }
  };

  const loadProject = async () => {
    if (!tenant || !projectId) return;

    try {
      setLoading(true);
      const projectRef = doc(db, "projects", projectId);
      const projectDoc = await getDoc(projectRef);

      if (projectDoc.exists()) {
        const projectData = { id: projectDoc.id, ...projectDoc.data() } as Project;
        
        // Verify tenant access
        if (projectData.tenant_id !== tenant.id) {
          showError("Access denied");
          router.push("/projects");
          return;
        }

        setCurrentProject(projectData);
      } else {
        showError("Space not found");
        router.push("/projects");
      }
    } catch (error) {
      console.error("[ProjectDetailsContent] Error loading project:", error);
      showError("Failed to load space");
    } finally {
      setLoading(false);
    }
  };

  const handleMenuItemChange = (item: string) => {
    // Reset states when navigating between menu items
    if (item !== activeMenuItem) {
      // Reset Content Types view state
      setSelectedContentType(null);
      
      // Reset Content/Entries view state
      setSelectedEntry(null);
      setEditingEntry(null);
      setIsEditingEntry(false);
      
      // Reset Media view state
      setShowMediaUpload(false);
    }
    
    setActiveMenuItem(item as MenuItem);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', item);
    router.push(`/project/${projectId}?${params.toString()}`);
  };

  const handleUpdateProject = async (newName: string, newDescription?: string) => {
    if (!currentProject || !tenant) return;

    try {
      const projectRef = doc(db, "projects", currentProject.id);
      
      const updates: any = {
        name: newName,
        updated_at: new Date().toISOString(),
      };

      if (newDescription !== undefined) {
        updates.description = newDescription;
      }

      await updateDoc(projectRef, updates);

      setCurrentProject({
        ...currentProject,
        ...updates,
      });

      showSuccess("Space updated successfully");
      
      // Update breadcrumbs by reloading
      await loadProject();
    } catch (error) {
      console.error("[ProjectDetailsContent] Error updating project:", error);
      showError("Failed to update space");
      throw error;
    }
  };

  const handleDeleteProject = async () => {
    if (!currentProject || !tenant) return;

    try {
      const projectRef = doc(db, "projects", currentProject.id);
      await deleteDoc(projectRef);
      
      showSuccess("Space deleted successfully");
      router.push("/projects");
    } catch (error) {
      console.error("[ProjectDetailsContent] Error deleting project:", error);
      showError("Failed to delete space");
    }
  };

  const handleAddEnvironment = () => {
    setEditingEnvironment(null);
    setShowEnvironmentModal(true);
  };

  const handleSaveEnvironment = async (data: {
    name: string;
    description?: string;
    is_default: boolean;
  }) => {
    if (!tenant || !user) return;

    try {
      if (editingEnvironment) {
        const updatedEnv = await updateEnvironment(editingEnvironment.id, user.uid, data);
        showSuccess("Environment updated successfully");
        await refreshEnvironments();
        // Keep the updated environment selected
        setSelectedEnvironment(updatedEnv);
      } else {
        const newEnv = await createEnvironment(projectId, tenant.id, user.uid, data);
        showSuccess("Environment created successfully");
        await refreshEnvironments();
        // Auto-select the newly created environment
        setSelectedEnvironment(newEnv);
      }
    } catch (error) {
      console.error("[ProjectDetailsContent] Error saving environment:", error);
      showError("Failed to save environment");
      throw error;
    }
  };

  const setupContentTypesListener = () => {
    if (!selectedEnvironment || !tenant) return;

    try {
      setLoadingContentTypes(true);

      const contentTypesRef = collection(db, "content_types");
      const q = query(
        contentTypesRef,
        where("project_id", "==", projectId),
        where("tenant_id", "==", tenant.id),
        where("environment_id", "==", selectedEnvironment.id),
        orderBy("created_at", "desc")
      );

      // Set up real-time listener
      const unsubscribe = onSnapshot(
        q,
        (querySnapshot) => {
          const types = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as ContentType[];

          setContentTypes(types);
          
          // Update selected content type if it changed
          if (selectedContentType) {
            const updated = types.find(ct => ct.id === selectedContentType.id);
            if (updated) {
              setSelectedContentType(updated);
            } else {
              // Content type was deleted
              setSelectedContentType(null);
            }
          }
          
          // Update entry content type if it changed (important for Content tab)
          if (entryContentType) {
            const updatedEntryContentType = types.find(ct => ct.id === entryContentType.id);
            if (updatedEntryContentType) {
              setEntryContentType(updatedEntryContentType);
            } else {
              // Content type was deleted
              setEntryContentType(null);
            }
          }

          setLoadingContentTypes(false);
        },
        (error) => {
          console.error("[ProjectDetailsContent] Error in content types listener:", error);
          showError("Failed to load content types");
          setLoadingContentTypes(false);
        }
      );

      return unsubscribe;
    } catch (error) {
      console.error("[ProjectDetailsContent] Error setting up listener:", error);
      showError("Failed to load content types");
      setLoadingContentTypes(false);
    }
  };

  const loadContentTypes = async () => {
    if (!selectedEnvironment || !tenant) return;

    try {
      setLoadingContentTypes(true);
      const types = await getEnvironmentContentTypes(
        projectId,
        tenant.id,
        selectedEnvironment.id
      );
      setContentTypes(types);
      
      // Clear selected content type if it's not in the new environment
      if (selectedContentType && !types.find(ct => ct.id === selectedContentType.id)) {
        setSelectedContentType(null);
      }
    } catch (error) {
      console.error("[ProjectDetailsContent] Error loading content types:", error);
      showError("Failed to load content types");
    } finally {
      setLoadingContentTypes(false);
    }
  };

  const handleCreateContentType = () => {
    setEditingContentType(null);
    setShowContentTypeModal(true);
  };

  const handleSaveContentType = async (data: {
    name: string;
    apiId: string;
    description?: string;
  }) => {
    if (!tenant || !user || !selectedEnvironment) return;

    try {
      if (editingContentType) {
        await updateContentType(editingContentType.id, user.uid, {
          name: data.name,
          apiId: data.apiId,
          description: data.description,
        });
        showSuccess("Content type updated successfully");
        await loadContentTypes();
      } else {
        // Create new content type with a default field
        const defaultField = {
          id: "title",
          name: "Title",
          type: "Symbol" as const,
          localized: false,
          required: true,
          disabled: false,
          omitted: false,
          validations: [],
        };

        const newContentType = await createContentType(
          projectId,
          tenant.id,
          selectedEnvironment.id,
          user.uid,
          {
            name: data.name,
            apiId: data.apiId,
            description: data.description,
            display_field: "title",
            fields: [defaultField],
          }
        );
        
        showSuccess("Content type created successfully");
        await loadContentTypes();
        // Auto-select the newly created content type
        setSelectedContentType(newContentType);
      }
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error saving content type:", error);
      showError(error.message || "Failed to save content type");
      throw error;
    }
  };

  const handleFieldAdded = async () => {
    // The real-time listener will automatically update the content types
    // No need to manually reload
  };
  
  const setupEntriesListener = () => {
    if (!entryContentType || !selectedEnvironment || !tenant) return;

    try {
      setLoadingEntries(true);

      const entriesRef = collection(db, "entries");
      const q = query(
        entriesRef,
        where("content_type_id", "==", entryContentType.id),
        where("project_id", "==", projectId),
        where("tenant_id", "==", tenant.id),
        where("environment_id", "==", selectedEnvironment.id),
        orderBy("updated_at", "desc")
      );

      // Set up real-time listener
      const unsubscribe = onSnapshot(
        q,
        (querySnapshot) => {
          const loadedEntries = querySnapshot.docs.map((doc) => 
            doc.data() as Entry
          );

          setEntries(loadedEntries);
          
          // Update selected entry if it changed
          if (selectedEntry) {
            const updated = loadedEntries.find(e => e.id === selectedEntry.id);
            if (updated) {
              setSelectedEntry(updated);
            } else {
              // Entry was deleted
              setSelectedEntry(null);
            }
          }

          setLoadingEntries(false);
        },
        (error) => {
          console.error("[ProjectDetailsContent] Error in entries listener:", error);
          showError("Failed to load entries");
          setLoadingEntries(false);
        }
      );

      return unsubscribe;
    } catch (error) {
      console.error("[ProjectDetailsContent] Error setting up entries listener:", error);
      showError("Failed to load entries");
      setLoadingEntries(false);
    }
  };
  
  const handleSelectContentTypeForEntries = (contentType: ContentType) => {
    setEntryContentType(contentType);
    setSelectedEntry(null);
  };
  
  const handleCreateEntry = () => {
    setEditingEntry(null);
    setIsEditingEntry(true);
    setSelectedEntry(null);
  };
  
  const handleSelectEntry = (entry: Entry) => {
    setSelectedEntry(entry);
    setEditingEntry(entry);
    setIsEditingEntry(true);
  };
  
  const handleCancelEdit = () => {
    setIsEditingEntry(false);
    setEditingEntry(null);
    setSelectedEntry(null);
  };
  
  const handleSaveEntry = async (fields: EntryFields, shouldPublish: boolean) => {
    if (!entryContentType || !selectedEnvironment || !tenant || !user) {
      throw new Error("Missing required data");
    }

    try {
      let savedEntry: Entry;
      
      if (editingEntry) {
        // Update existing entry
        const updatedEntry = await updateEntry(editingEntry.id, user.uid, fields);

        // Publish if requested
        if (shouldPublish) {
          savedEntry = await publishEntry(updatedEntry.id, user.uid);
          showSuccess(updatedEntry.status === "published" ? "Changes published successfully" : "Entry published successfully");
        } else {
          savedEntry = updatedEntry;
          showSuccess("Entry saved as draft");
        }
      } else {
        // Create new entry - use atomic publish to avoid race condition
        savedEntry = await createEntry(
          entryContentType.id,
          projectId,
          tenant.id,
          selectedEnvironment.id,
          user.uid,
          fields,
          { publish: shouldPublish } // Create with correct status atomically
        );
        
        showSuccess(shouldPublish ? "Entry created and published" : "Entry created as draft");
      }
      
      // Stay in edit mode with the saved entry
      setSelectedEntry(savedEntry);
      setEditingEntry(savedEntry);
      setIsEditingEntry(true);
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error saving entry:", error);
      showError(error.message || "Failed to save entry");
      throw error;
    }
  };
  
  const handleDeleteEntry = async (entryId: string) => {
    if (!user) return;

    try {
      await deleteEntry(entryId);
      showSuccess("Entry deleted successfully");
      setSelectedEntry(null);
      setIsEditingEntry(false);
      setEditingEntry(null);
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error deleting entry:", error);
      showError(error.message || "Failed to delete entry");
      throw error;
    }
  };
  
  const handleArchiveEntry = async (entryId: string) => {
    if (!user) return;

    try {
      await archiveEntry(entryId, user.uid);
      showSuccess("Entry archived successfully");
      setIsEditingEntry(false);
      setEditingEntry(null);
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error archiving entry:", error);
      showError(error.message || "Failed to archive entry");
      throw error;
    }
  };

  const handleScheduleEntry = async (entryId: string, data: {
    action: "publish" | "unpublish";
    scheduledFor: Date;
    timezone: string;
  }) => {
    if (!user) return;

    try {
      const updatedEntry = await scheduleEntryAction(entryId, user.uid, data);
      showSuccess(`Scheduled to ${data.action} on ${data.scheduledFor.toLocaleString()}`);
      setEditingEntry(updatedEntry);
      setSelectedEntry(updatedEntry);
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error scheduling entry:", error);
      showError(error.message || "Failed to schedule action");
      throw error;
    }
  };

  const handleCancelSchedule = async (entryId: string) => {
    if (!user) return;

    try {
      const updatedEntry = await cancelScheduledAction(entryId, user.uid);
      showSuccess("Scheduled action cancelled");
      setEditingEntry(updatedEntry);
      setSelectedEntry(updatedEntry);
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error cancelling schedule:", error);
      showError(error.message || "Failed to cancel scheduled action");
      throw error;
    }
  };
  
  const handleUploadMedia = async (filesWithNames: { file: File; name: string }[]) => {
    if (!tenant || !user || !selectedEnvironment) return;
    
    try {
      // Upload each file with its custom name
      const uploadPromises = filesWithNames.map(async ({ file, name }) => {
        const title = {
          "en-US": name,
        };
        
        const description = {
          "en-US": "",
        };
        
        return await createAsset(
          projectId,
          tenant.id,
          selectedEnvironment.id,
          user.uid,
          file,
          title,
          description,
          "en-US"
        );
      });
      
      await Promise.all(uploadPromises);
      showSuccess(`${filesWithNames.length} file${filesWithNames.length > 1 ? "s" : ""} uploaded successfully`);
      
      // Reload assets
      await loadAssets();
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error uploading media:", error);
      showError(error.message || "Failed to upload files");
      throw error;
    }
  };
  
  const loadAssets = async () => {
    if (!tenant || !selectedEnvironment) return;
    
    try {
      setLoadingAssets(true);
      const environmentAssets = await getEnvironmentAssets(projectId, tenant.id, selectedEnvironment.id);
      setAssets(environmentAssets);
    } catch (error) {
      console.error("[ProjectDetailsContent] Error loading assets:", error);
      showError("Failed to load media");
    } finally {
      setLoadingAssets(false);
    }
  };
  
  const handleUpdateAsset = async (assetId: string, title: string) => {
    if (!user) return;
    
    try {
      await updateAsset(assetId, user.uid, {
        title: { "en-US": title },
      });
      showSuccess("Media updated successfully");
      await loadAssets();
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error updating asset:", error);
      showError(error.message || "Failed to update media");
      throw error;
    }
  };
  
  const handleDeleteAsset = async (assetId: string) => {
    if (!user) return;
    
    try {
      await deleteAsset(assetId);
      showSuccess("Media deleted successfully");
      await loadAssets();
    } catch (error: any) {
      console.error("[ProjectDetailsContent] Error deleting asset:", error);
      showError(error.message || "Failed to delete media");
      throw error;
    }
  };
  
  // Load assets when environment changes
  useEffect(() => {
    if (tenant && selectedEnvironment) {
      loadAssets();
    }
  }, [tenant, projectId, selectedEnvironment]);

  if (combinedLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <O2Loader size="md" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <div className="text-[var(--text-tertiary)]">No tenant found</div>
      </div>
    );
  }

  return (
    <div
      id="ProjectDetailsPage"
      className="flex flex-col h-screen bg-[var(--background-gray-main)]"
    >
      <Header 
        showSidebarToggle={false} 
        isSmallScreen={false} 
        showSettingsButton={true}
        userRole={userRole}
        hasSettingsAccess={Boolean(
          claims?.permissions?.api_key_actions?.length ||
          claims?.permissions?.role_actions?.length ||
          claims?.permissions?.user_actions?.length
        )}
      />
      
      {/* Breadcrumbs and Environment Selector */}
      <div className="flex items-center justify-between px-6 py-2 bg-white border-b border-[var(--border-main)]">
        <Breadcrumbs
          items={currentProject ? [
            { label: "Spaces", href: "/projects" },
            { label: currentProject.name },
          ] : []}
          loading={loading || !currentProject}
        />
        
        <EnvironmentSelector
          environments={environments}
          selectedEnvironment={selectedEnvironment}
          onSelect={setSelectedEnvironment}
          onAddNew={handleAddEnvironment}
          loading={loading}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Project Sidebar */}
        <ProjectSidebar 
          projectId={projectId}
          projectName={currentProject?.name}
          activeItem={activeMenuItem}
          onNavigate={handleMenuItemChange}
          onSettings={() => setShowSettingsModal(true)}
        />

        {/* Main Content - Different views based on active menu */}
        {activeMenuItem === "media" ? (
          /* Media View */
          <div id="MediaViewContainer" className="flex flex-1 overflow-hidden">
            <MediaLibrary
              projectId={projectId}
              tenantId={tenant.id}
              environmentId={selectedEnvironment?.id}
              assets={assets}
              loading={loadingAssets}
              onUpload={() => setShowMediaUpload(true)}
              onAssetUpdate={handleUpdateAsset}
              onAssetDelete={handleDeleteAsset}
            />
          </div>
        ) : activeMenuItem === "content" ? (
          /* Content View - Two Panels */
          <div id="ContentViewContainer" className="flex flex-1 overflow-hidden">
            {contentTypes.length === 0 ? (
              /* No Content Types - Show Message */
              <div id="NoContentTypesMessage" className="flex-1 flex items-center justify-center bg-[var(--background-gray-main)]">
                <div className="text-center px-6">
                  <FileText size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
                  <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
                    No content types yet
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mb-4">
                    Create a content type first, then start adding content
                  </p>
                  <button
                    onClick={() => setActiveMenuItem("content-types")}
                    className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium"
                  >
                    Go to Content Types
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Left Panel - Entry List (2 parts) */}
                <div id="EntryListPanel" className="flex-[2] border-r border-[var(--border-main)] overflow-hidden flex flex-col">
                  {/* Content Type Selector - Now inside Entry List Panel */}
                  <div id="ContentTypeSelectorWrapper" className="p-4 bg-white border-b border-[var(--border-main)]">
                    <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-2">
                      Select Content Type
                    </label>
                    <Dropdown
                      options={contentTypes.map((ct) => ({
                        value: ct.id,
                        label: ct.name,
                        subtitle: ct.apiId,
                      }))}
                      value={entryContentType?.id || ""}
                      onChange={(ctId) => {
                        const ct = contentTypes.find(ct => ct.id === ctId);
                        if (ct) handleSelectContentTypeForEntries(ct);
                      }}
                      placeholder="Choose a content type..."
                    />
                  </div>

                  {/* Entry List */}
                  <div className="flex-1 overflow-hidden flex flex-col">
                    {selectedEnvironment && (
                      <EntryList
                        entries={entries}
                        contentType={entryContentType}
                        loading={loadingEntries}
                        onSelectEntry={handleSelectEntry}
                        onCreateEntry={handleCreateEntry}
                        selectedEntry={selectedEntry}
                        projectId={projectId}
                        environmentId={selectedEnvironment.id}
                      />
                    )}
                  </div>
                </div>

                {/* Right Panel - Entry Editor (5 parts) */}
                <div id="EntryDetailsPanel" className="flex-[5] overflow-hidden">
                  {isEditingEntry && entryContentType ? (
                    <EntryEditorInline
                      contentType={entryContentType}
                      entry={editingEntry}
                      onSave={handleSaveEntry}
                      onDelete={handleDeleteEntry}
                      onArchive={handleArchiveEntry}
                      onSchedule={handleScheduleEntry}
                      onCancelSchedule={handleCancelSchedule}
                      onCancel={handleCancelEdit}
                      assets={assets}
                      onAssetUpload={handleUploadMedia}
                      contentTypes={contentTypes}
                    />
                  ) : (
                    <div id="EntryDetailsContainer" className="flex-1 flex items-center justify-center bg-white h-full">
                      <div className="text-center max-w-md px-4">
                        <FileText size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
                        <div className="text-sm text-[var(--text-secondary)] mb-2">
                          Select an entry to edit
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)]">
                          or create a new one to get started
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          /* Content Types View - Two Panels */
          <div id="ContentTypesViewContainer" className="flex flex-1 overflow-hidden">
            {/* Left Panel - Content Types List */}
            <div id="ContentTypeListPanel" className="h-full">
              <ContentTypeList
                contentTypes={contentTypes}
                selectedContentType={selectedContentType}
                onSelect={setSelectedContentType}
                onCreate={handleCreateContentType}
                loading={loadingContentTypes}
                projectId={projectId}
                environmentId={selectedEnvironment?.id}
              />
            </div>

            {/* Right Panel - Content Type Details */}
            <div id="ContentTypeDetailsPanel" className="flex-1 overflow-hidden">
              <ContentTypeDetails
                contentType={selectedContentType}
                loading={loadingContentTypes}
                onFieldAdded={handleFieldAdded}
                availableContentTypes={contentTypes}
                onContentTypeDeleted={() => {
                  // Real-time listener will handle the update
                  setSelectedContentType(null);
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Project Settings Modal */}
      {currentProject && (
        <ProjectSettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          project={currentProject}
          environmentId={selectedEnvironment?.id}
          onUpdate={handleUpdateProject}
          onDelete={handleDeleteProject}
          onEnvironmentChange={refreshEnvironments}
          onResetToDefaultEnvironment={resetToDefaultEnvironment}
        />
      )}

      {/* Environment Modal */}
      <EnvironmentModal
        isOpen={showEnvironmentModal}
        onClose={() => {
          setShowEnvironmentModal(false);
          setEditingEnvironment(null);
        }}
        onSave={handleSaveEnvironment}
        environment={editingEnvironment}
        existingEnvironments={environments}
      />

      {/* Content Type Modal */}
      <ContentTypeModal
        isOpen={showContentTypeModal}
        onClose={() => {
          setShowContentTypeModal(false);
          setEditingContentType(null);
        }}
        onSave={handleSaveContentType}
        contentType={editingContentType}
        existingContentTypes={contentTypes}
      />

      {/* Media Upload Modal */}
      <MediaUploadModal
        isOpen={showMediaUpload}
        onClose={() => setShowMediaUpload(false)}
        onUpload={handleUploadMedia}
      />
    </div>
  );
}

// Wrapper to provide Typesense context
function ProjectDetailsWithTypesense({ projectId, tenantId }: { projectId: string; tenantId: string }) {
  return (
    <TypesenseProvider tenantId={tenantId}>
      <ProjectDetailsInner projectId={projectId} />
    </TypesenseProvider>
  );
}

export default function ProjectDetailsContent({ projectId }: ProjectDetailsContentProps) {
  const { user, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant(user);

  if (authLoading || tenantLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <O2Loader size="md" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <div className="text-[var(--text-tertiary)]">No tenant found</div>
      </div>
    );
  }

  return (
    <EnvironmentProvider projectId={projectId} tenantId={tenant.id}>
      <ProjectDetailsWithTypesense projectId={projectId} tenantId={tenant.id} />
    </EnvironmentProvider>
  );
}
