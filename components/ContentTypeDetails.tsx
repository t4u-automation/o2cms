"use client";

import {
  useState,
  useEffect,
  useRef,
  type DragEvent,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { ContentType, FieldType, ContentTypeField } from "@/types";
import { 
  FileType, 
  Plus, 
  GripVertical, 
  Trash2,
  Type,
  AlignLeft,
  FileText,
  Hash,
  Calendar,
  ToggleLeft,
  MapPin,
  Braces,
  List,
  Link as LinkIcon,
  Image
} from "lucide-react";
import { ContentTypeDetailsSkeleton } from "./Skeleton";
import FieldTypeSelector from "./FieldTypeSelector";
import FieldConfigurationModal from "./FieldConfigurationModal";
import ConfirmDialog from "./ConfirmDialog";
import { updateContentType, deleteContentType } from "@/lib/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";

interface ContentTypeDetailsProps {
  contentType: ContentType | null;
  loading?: boolean;
  onFieldAdded?: () => void;
  availableContentTypes?: ContentType[];
  onContentTypeDeleted?: () => void;
}

export default function ContentTypeDetails({
  contentType,
  loading = false,
  onFieldAdded,
  availableContentTypes = [],
  onContentTypeDeleted,
}: ContentTypeDetailsProps) {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const [showFieldTypeSelector, setShowFieldTypeSelector] = useState(false);
  const [showFieldConfigModal, setShowFieldConfigModal] = useState(false);
  const [selectedFieldType, setSelectedFieldType] = useState<FieldType | null>(null);
  const [selectedLinkType, setSelectedLinkType] = useState<"Entry" | "Asset" | null>(null);
  const [editingField, setEditingField] = useState<ContentTypeField | null>(null);
  const [currentDisplayField, setCurrentDisplayField] = useState(contentType?.display_field ?? "");
  const [fields, setFields] = useState<ContentTypeField[]>(contentType?.fields ?? []);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);
  const [hasPendingOrderChange, setHasPendingOrderChange] = useState(false);
  const [didDropInsideList, setDidDropInsideList] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [fieldPendingDeletion, setFieldPendingDeletion] = useState<ContentTypeField | null>(null);
  const [isDeletingField, setIsDeletingField] = useState(false);
  const [showDeleteContentTypeDialog, setShowDeleteContentTypeDialog] = useState(false);
  const [isDeletingContentType, setIsDeletingContentType] = useState(false);
  const dragSnapshotRef = useRef<ContentTypeField[]>([]);

  const getFieldIcon = (field: ContentTypeField) => {
    const iconProps = { size: 16, className: "text-[var(--icon-secondary)]" };
    const type = field.type;
    
    switch (type) {
      case "Symbol":
        return <Type {...iconProps} />;
      case "Text":
        return <AlignLeft {...iconProps} />;
      case "RichText":
        return <FileText {...iconProps} />;
      case "Integer":
      case "Number":
        return <Hash {...iconProps} />;
      case "Date":
        return <Calendar {...iconProps} />;
      case "Boolean":
        return <ToggleLeft {...iconProps} />;
      case "Location":
        return <MapPin {...iconProps} />;
      case "Object":
        return <Braces {...iconProps} />;
      case "Array":
        // Check if it's a multiple assets field
        if (field.items?.type === "Link" && field.items?.linkType === "Asset") {
          return <Image {...iconProps} />;
        }
        // Check if it's a multiple references field
        if (field.items?.type === "Link" && field.items?.linkType === "Entry") {
          return <LinkIcon {...iconProps} />;
        }
        return <List {...iconProps} />;
      case "Link":
        // Check if it's a media (Asset) or reference (Entry)
        if (field.linkType === "Asset") {
          return <Image {...iconProps} />;
        }
        return <LinkIcon {...iconProps} />;
      default:
        return <Type {...iconProps} />;
    }
  };

  const getFieldTypeDisplay = (field: ContentTypeField): string => {
    const type = field.type;
    
    // Handle Array types
    if (type === "Array") {
      if (field.items?.type === "Link") {
        if (field.items?.linkType === "Asset") {
          return "Media (multiple)";
        }
        if (field.items?.linkType === "Entry") {
          return "References (multiple)";
        }
      }
      // Array of Symbols (text list/tags)
      if (field.items?.type === "Symbol") {
        return "Text (list)";
      }
      // Generic array - show item type if available
      return field.items?.type ? `${field.items.type} (list)` : "Array";
    }
    
    // Handle Link types
    if (type === "Link") {
      if (field.linkType === "Asset") {
        return "Media";
      }
      if (field.linkType === "Entry") {
        return "Reference";
      }
    }
    
    // Return friendly names for other types
    const typeLabels: Record<string, string> = {
      Symbol: "Short text",
      Text: "Long text",
      RichText: "Rich text",
      Integer: "Integer",
      Number: "Decimal",
      Date: "Date & time",
      Boolean: "Boolean",
      Location: "Location",
      Object: "JSON object",
    };
    
    return typeLabels[type] || type;
  };

  useEffect(() => {
    if (contentType?.fields) {
      setFields(contentType.fields);
      dragSnapshotRef.current = [...contentType.fields];
      setCurrentDisplayField(contentType.display_field);
    } else {
      setFields([]);
      dragSnapshotRef.current = [];
      setCurrentDisplayField("");
    }
  }, [contentType]);

  const handleAddField = () => {
    setShowFieldTypeSelector(true);
  };

  const handleFieldTypeSelect = (type: FieldType, linkType?: "Entry" | "Asset") => {
    setShowFieldTypeSelector(false);
    setEditingField(null);
    setSelectedFieldType(type);
    setSelectedLinkType(linkType || null);
    setShowFieldConfigModal(true);
  };

  const handleFieldClick = (field: ContentTypeField) => {
    if (draggingFieldId) return;
    setEditingField(field);
    
    // If it's an Array of Asset Links, treat it as a Link field with Asset type
    if (field.type === "Array" && field.items?.type === "Link" && field.items?.linkType === "Asset") {
      setSelectedFieldType("Link");
      setSelectedLinkType("Asset");
    } else if (field.type === "Array" && field.items?.type === "Link" && field.items?.linkType === "Entry") {
      // If it's an Array of Entry Links, treat it as a Link field with Entry type
      setSelectedFieldType("Link");
      setSelectedLinkType("Entry");
    } else if (field.type === "Array" && field.items?.type === "Symbol") {
      // If it's an Array of Symbols (text list), treat it as a Symbol field
      setSelectedFieldType("Symbol");
      setSelectedLinkType(null);
    } else {
      setSelectedFieldType(field.type);
      setSelectedLinkType(field.linkType || null);
    }
    
    setShowFieldConfigModal(true);
  };

  const handleRequestDeleteField = (event: MouseEvent, field: ContentTypeField) => {
    event.stopPropagation();
    if (isSavingOrder) return;
    setFieldPendingDeletion(field);
  };

  const handleFieldKeyDown = (event: KeyboardEvent<HTMLDivElement>, field: ContentTypeField) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleFieldClick(field);
    }
  };

  const handleDeleteField = async () => {
    if (!contentType || !user || !fieldPendingDeletion) return;

    const updatedFields = fields.filter((field) => field.id !== fieldPendingDeletion.id);
    const updatePayload: { fields: ContentTypeField[]; display_field?: string } = {
      fields: updatedFields,
    };

    if (currentDisplayField === fieldPendingDeletion.id) {
      const nextDisplayField = updatedFields[0]?.id ?? "";
      updatePayload.display_field = nextDisplayField;
      setCurrentDisplayField(nextDisplayField);
    }

    setIsDeletingField(true);
    try {
      await updateContentType(contentType.id, user.uid, updatePayload);
      setFields(updatedFields);
      dragSnapshotRef.current = [...updatedFields];
      showSuccess("Field deleted successfully");
      if (onFieldAdded) {
        onFieldAdded();
      }
    } catch (error: any) {
      console.error("Error deleting field:", error);
      showError(error.message || "Failed to delete field");
      // revert local display field if request failed
      setCurrentDisplayField(contentType.display_field);
    } finally {
      setIsDeletingField(false);
      setFieldPendingDeletion(null);
    }
  };

  const persistFieldOrder = async (orderedFields: ContentTypeField[]) => {
    if (!contentType || !user) return;

    setIsSavingOrder(true);
    try {
      await updateContentType(contentType.id, user.uid, {
        fields: orderedFields,
      });
      dragSnapshotRef.current = [...orderedFields];
      showSuccess("Field order updated");
      if (onFieldAdded) {
        onFieldAdded();
      }
    } catch (error: any) {
      console.error("Error updating field order:", error);
      showError(error.message || "Failed to update field order");
      setFields(dragSnapshotRef.current.length ? dragSnapshotRef.current : orderedFields);
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, fieldId: string) => {
    if (isSavingOrder) return;
    event.dataTransfer.effectAllowed = "move";
    dragSnapshotRef.current = [...fields];
    setDraggingFieldId(fieldId);
    setHoveredFieldId(null);
    setHasPendingOrderChange(false);
    setDidDropInsideList(false);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, targetFieldId: string) => {
    event.preventDefault();
    if (!draggingFieldId || draggingFieldId === targetFieldId) {
      return;
    }

    setFields((prevFields) => {
      const currentIndex = prevFields.findIndex((field) => field.id === draggingFieldId);
      const targetIndex = prevFields.findIndex((field) => field.id === targetFieldId);

      if (currentIndex === -1 || targetIndex === -1 || currentIndex === targetIndex) {
        return prevFields;
      }

      const updated = [...prevFields];
      const [movedField] = updated.splice(currentIndex, 1);
      updated.splice(targetIndex, 0, movedField);
      return updated;
    });

    setHoveredFieldId(targetFieldId);
    setHasPendingOrderChange(true);
  };

  const handleDropZone = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFieldId) return;
    event.preventDefault();
    setDidDropInsideList(true);
  };

  const handleDragLeave = (fieldId: string) => {
    if (hoveredFieldId === fieldId) {
      setHoveredFieldId(null);
    }
  };

  const handleDragEnd = async () => {
    const droppedInside = didDropInsideList;
    const shouldPersist = hasPendingOrderChange && draggingFieldId !== null;

    setDraggingFieldId(null);
    setHoveredFieldId(null);
    setDidDropInsideList(false);

    if (!shouldPersist) {
      setHasPendingOrderChange(false);
      return;
    }

    if (!droppedInside) {
      setFields(dragSnapshotRef.current);
      setHasPendingOrderChange(false);
      return;
    }

    try {
      await persistFieldOrder([...fields]);
    } finally {
      setHasPendingOrderChange(false);
    }
  };

  const handleSaveField = async (field: ContentTypeField) => {
    if (!contentType || !user) return;

    try {
      const isEditingField = !!editingField;
      const updatedFields = isEditingField
        ? fields.map((existingField) =>
            existingField.id === field.id ? field : existingField
          )
        : [...fields, field];

      await updateContentType(contentType.id, user.uid, {
        fields: updatedFields,
      });

      setFields(updatedFields);
      dragSnapshotRef.current = [...updatedFields];
      showSuccess(isEditingField ? "Field updated successfully" : "Field added successfully");
      
      // Notify parent to reload
      if (onFieldAdded) {
        onFieldAdded();
      }
    } catch (error: any) {
      console.error("Error saving field:", error);
      showError(error.message || "Failed to save field");
      throw error;
    }
  };

  const handleDeleteContentType = async () => {
    if (!contentType || !user) return;

    setIsDeletingContentType(true);
    try {
      await deleteContentType(contentType.id);
      showSuccess("Content type deleted successfully");
      setShowDeleteContentTypeDialog(false);
      
      // Notify parent that content type was deleted
      if (onContentTypeDeleted) {
        onContentTypeDeleted();
      }
    } catch (error: any) {
      console.error("Error deleting content type:", error);
      showError(error.message || "Failed to delete content type");
    } finally {
      setIsDeletingContentType(false);
    }
  };

  if (loading) {
    return <ContentTypeDetailsSkeleton />;
  }

  if (!contentType) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white h-full">
        <div className="text-center max-w-md px-4">
          <FileType size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
          <div className="text-sm text-[var(--text-secondary)] mb-2">
            Select a content type to view details
          </div>
          <div className="text-xs text-[var(--text-tertiary)]">
            or create a new one to get started
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--border-main)] flex-shrink-0">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-xl font-bold text-[var(--text-primary)]">
                {contentType.name}
              </h1>
            </div>
            <div className="text-sm text-[var(--text-tertiary)] mb-1">
              API ID: <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">{contentType.apiId}</code>
            </div>
            {contentType.description && (
              <p className="text-sm text-[var(--text-secondary)] mt-2">
                {contentType.description}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowDeleteContentTypeDialog(true)}
            className="ml-4 p-2 text-red-600 hover:bg-red-50 rounded-[6px] transition-colors"
            title="Delete content type"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Content - Fields Info */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Fields ({fields.length})
            </h3>
            <button
              onClick={handleAddField}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              <span>Add field</span>
            </button>
          </div>
      {fields.length > 0 && (
        <div className="flex items-center justify-between mb-2 text-xs text-[var(--text-tertiary)]">
          <p>Drag and drop fields to reorder them.</p>
          {isSavingOrder && <span className="text-[var(--text-secondary)]">Saving order...</span>}
        </div>
      )}
          
      {fields.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <p className="text-sm text-[var(--text-secondary)]">
                No fields defined yet
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Add fields to define the structure of this content type
              </p>
            </div>
      ) : (
        <div
          className="space-y-2"
          onDragOver={(event) => {
            if (draggingFieldId) event.preventDefault();
          }}
          onDrop={handleDropZone}
        >
          {fields.map((field) => {
            const isDragging = draggingFieldId === field.id;
            const isDropTarget = hoveredFieldId === field.id && !isDragging;

            return (
              <div
                key={field.id}
                draggable={!isSavingOrder}
                aria-grabbed={isDragging}
                onDragStart={(event) => handleDragStart(event, field.id)}
                onDragOver={(event) => handleDragOver(event, field.id)}
                onDragLeave={() => handleDragLeave(field.id)}
                onDragEnd={handleDragEnd}
                onClick={() => handleFieldClick(field)}
                onKeyDown={(event) => handleFieldKeyDown(event, field)}
                role="button"
                tabIndex={0}
                className={`w-full text-left p-4 border rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--Button-primary-black)] ${
                  isDropTarget
                    ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)]"
                    : "border-[var(--border-main)] hover:bg-gray-50"
                } ${
                  isDragging ? "opacity-70 cursor-grabbing" : "cursor-grab"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getFieldIcon(field)}
                      <h4 className="text-sm font-medium text-[var(--text-primary)]">
                        {field.name}
                      </h4>
                      {field.required && (
                        <span className="text-xs text-red-500">*</span>
                      )}
                      {field.localized && (
                        <span className="px-1.5 py-0.5 bg-[var(--fill-tsp-gray-main)] text-[var(--text-secondary)] text-xs rounded">
                          Localized
                        </span>
                      )}
                      {currentDisplayField === field.id && (
                        <span className="px-1.5 py-0.5 bg-[var(--fill-tsp-white-dark)] text-[var(--text-primary)] text-xs rounded">
                          Entry Title
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)]">
                      Field ID: <code className="px-1 py-0.5 bg-gray-100 rounded">{field.id}</code>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-1">
                      Type: <span className="font-medium">{getFieldTypeDisplay(field)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--icon-secondary)]">
                    <button
                      type="button"
                      onClick={(event) => handleRequestDeleteField(event, field)}
                      className="p-1 rounded hover:bg-gray-100 text-red-500"
                      aria-label={`Delete ${field.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                    <GripVertical size={18} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </div>
      </div>

      {/* Field Type Selector Modal */}
      <FieldTypeSelector
        isOpen={showFieldTypeSelector}
        onClose={() => setShowFieldTypeSelector(false)}
        onSelectType={handleFieldTypeSelect}
      />

      {/* Field Configuration Modal */}
      {contentType && (
        <FieldConfigurationModal
          isOpen={showFieldConfigModal}
          onClose={() => {
            setShowFieldConfigModal(false);
            setSelectedFieldType(null);
            setSelectedLinkType(null);
            setEditingField(null);
          }}
          fieldType={selectedFieldType}
          existingFields={fields}
          display_field={currentDisplayField}
          field={editingField ?? undefined}
          onSave={handleSaveField}
          initialLinkType={selectedLinkType ?? undefined}
          availableContentTypes={availableContentTypes}
          currentContentTypeId={contentType.id}
        />
      )}

      <ConfirmDialog
        isOpen={!!fieldPendingDeletion}
        title="Delete field?"
        message={
          fieldPendingDeletion
            ? `Are you sure you want to delete the field "${fieldPendingDeletion.name}"? This action cannot be undone.`
            : ""
        }
        confirmText={isDeletingField ? "Deleting..." : "Delete field"}
        cancelText="Cancel"
        isDanger
        onConfirm={() => {
          if (!isDeletingField) {
            handleDeleteField();
          }
        }}
        onCancel={() => {
          if (!isDeletingField) {
            setFieldPendingDeletion(null);
          }
        }}
      />

      <ConfirmDialog
        isOpen={showDeleteContentTypeDialog}
        title="Delete content type?"
        message={`Are you sure you want to delete "${contentType?.name}"? All entries of this content type will also be permanently deleted. This action cannot be undone.`}
        confirmText={isDeletingContentType ? "Deleting..." : "Delete content type"}
        cancelText="Cancel"
        isDanger
        onConfirm={() => {
          if (!isDeletingContentType) {
            handleDeleteContentType();
          }
        }}
        onCancel={() => {
          if (!isDeletingContentType) {
            setShowDeleteContentTypeDialog(false);
          }
        }}
      />
    </div>
  );
}

