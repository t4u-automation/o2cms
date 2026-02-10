"use client";

import { ContentTypeField } from "@/types";
import { useState, useEffect } from "react";
import { MapPin, Search, X, Loader2 } from "lucide-react";

interface LocationValue {
  lat?: number;
  lon?: number;
  address?: string;
}

interface LocationWidgetProps {
  field: ContentTypeField;
  value: LocationValue | null;
  onChange: (value: LocationValue | null) => void;
  disabled?: boolean;
  error?: boolean;
}

type InputMode = "address" | "coordinates";

export default function LocationWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
}: LocationWidgetProps) {
  const [mode, setMode] = useState<InputMode>("address");
  const [lat, setLat] = useState<string>("");
  const [lon, setLon] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [isGeocoding, setIsGeocoding] = useState(false);

  useEffect(() => {
    if (value && typeof value === "object") {
      if (value.lat !== undefined) setLat(value.lat.toString());
      if (value.lon !== undefined) setLon(value.lon.toString());
      if (value.address) {
        setAddress(value.address);
        // If we have an address but no coordinates, default to address mode
        if (value.lat === undefined && value.lon === undefined) {
          setMode("address");
        }
      }
      
      if (value.address) {
        setMode("address");
      } else if (value.lat !== undefined || value.lon !== undefined) {
        setMode("coordinates");
      }
    } else {
      setLat("");
      setLon("");
      setAddress("");
      setMode("address"); // Default to address
    }
  }, [value]);

  // Geocoding effect
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (mode === "address" && address && address.length > 3) {
        // Only geocode if we don't already have coordinates that match this address
        // or if the user is actively typing.
        // For simplicity, we'll just geocode on debounce.
        
        setIsGeocoding(true);
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`
          );
          const data = await response.json();
          if (data && data.length > 0) {
            const { lat: newLat, lon: newLon } = data[0];
            
            // Update local state for coordinates
            setLat(newLat);
            setLon(newLon);
            
            // Update parent with both address and new coordinates
            // We use the updateLocation helper but pass the new values directly
            // to ensure we save everything together.
            const latNum = parseFloat(newLat);
            const lonNum = parseFloat(newLon);
            
            if (!isNaN(latNum) && !isNaN(lonNum)) {
               onChange({
                 address: address,
                 lat: latNum,
                 lon: lonNum
               });
            }
          }
        } catch (error) {
          console.error("Geocoding error:", error);
        } finally {
          setIsGeocoding(false);
        }
      }
    }, 1000); // 1 second debounce

    return () => clearTimeout(timer);
  }, [address, mode]);

  const handleLatChange = (newLat: string) => {
    setLat(newLat);
    updateLocation(newLat, lon, address);
  };

  const handleLonChange = (newLon: string) => {
    setLon(newLon);
    updateLocation(lat, newLon, address);
  };

  const handleAddressChange = (newAddress: string) => {
    setAddress(newAddress);
    // We update the address immediately in the parent, but keep old coordinates
    // until geocoding finishes (or clears them if empty)
    if (!newAddress) {
      updateLocation(lat, lon, "");
    } else {
      // Pass current coordinates while typing, geocoding will update them later
      // or we could clear them to indicate "searching"? 
      // Better to keep them stable until we have new ones.
      updateLocation(lat, lon, newAddress);
    }
  };

  const updateLocation = (latValue: string, lonValue: string, addressValue: string) => {
    const latNum = parseFloat(latValue);
    const lonNum = parseFloat(lonValue);
    
    const newValue: LocationValue = {};
    
    if (addressValue) {
      newValue.address = addressValue;
    }

    if (!isNaN(latNum) && !isNaN(lonNum)) {
      // Validate ranges
      if (latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180) {
        newValue.lat = latNum;
        newValue.lon = lonNum;
      }
    }

    if (Object.keys(newValue).length > 0) {
      onChange(newValue);
    } else {
      onChange(null);
    }
  };

  const handleClear = () => {
    setLat("");
    setLon("");
    setAddress("");
    onChange(null);
  };

  // Parse current values for validation
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  const isLatValid = !lat || (!isNaN(latNum) && latNum >= -90 && latNum <= 90);
  const isLonValid = !lon || (!isNaN(lonNum) && lonNum >= -180 && lonNum <= 180);

  // Map preview URL
  let mapUrl = "";
  if (lat && lon && isLatValid && isLonValid) {
    mapUrl = `https://maps.google.com/maps?q=${lat},${lon}&z=15&output=embed`;
  } else if (address) {
    mapUrl = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=15&output=embed`;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <MapPin size={16} className="text-[var(--icon-secondary)]" />
        <span className="text-sm text-[var(--text-secondary)]">
          Location
        </span>
      </div>

      {/* Map Preview */}
      <div className="w-full h-64 bg-gray-100 rounded-lg overflow-hidden border border-[var(--border-main)] relative">
        {mapUrl ? (
          <iframe
            width="100%"
            height="100%"
            style={{ border: 0 }}
            loading="lazy"
            allowFullScreen
            src={mapUrl}
          ></iframe>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-tertiary)]">
            <div className="text-center">
              <MapPin size={32} className="mx-auto mb-2 opacity-50" />
              <span className="text-sm">Enter an address or coordinates to see the map</span>
            </div>
          </div>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={`location-mode-${field.id}`}
            checked={mode === "address"}
            onChange={() => setMode("address")}
            className="w-4 h-4 text-[var(--text-primary)] border-gray-300 focus:ring-black/20 accent-[var(--text-primary)]"
          />
          <span className="text-sm text-[var(--text-primary)]">Address</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={`location-mode-${field.id}`}
            checked={mode === "coordinates"}
            onChange={() => setMode("coordinates")}
            className="w-4 h-4 text-[var(--text-primary)] border-gray-300 focus:ring-black/20 accent-[var(--text-primary)]"
          />
          <span className="text-sm text-[var(--text-primary)]">Coordinates</span>
        </label>
      </div>

      {/* Inputs */}
      {mode === "address" ? (
        <div className="relative">
          <input
            type="text"
            value={address}
            onChange={(e) => handleAddressChange(e.target.value)}
            placeholder="Enter address..."
            disabled={disabled}
            className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-[var(--text-primary)] ${
              error ? "border-red-500" : "border-[var(--border-main)]"
            }`}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {isGeocoding && (
              <Loader2 size={16} className="text-[var(--text-tertiary)] animate-spin" />
            )}
            {address && (
              <button
                onClick={() => handleAddressChange("")}
                className="text-[var(--icon-tertiary)] hover:text-[var(--icon-primary)]"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {/* Latitude */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
              Latitude
            </label>
            <input
              type="number"
              value={lat}
              onChange={(e) => handleLatChange(e.target.value)}
              placeholder="e.g., 40.7128"
              disabled={disabled}
              step="any"
              min={-90}
              max={90}
              className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-[var(--text-primary)] ${
                error || !isLatValid
                  ? "border-red-500"
                  : "border-[var(--border-main)]"
              }`}
            />
            {!isLatValid && (
              <div className="mt-1 text-xs text-red-600">
                Must be between -90 and 90
              </div>
            )}
          </div>

          {/* Longitude */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
              Longitude
            </label>
            <input
              type="number"
              value={lon}
              onChange={(e) => handleLonChange(e.target.value)}
              placeholder="e.g., -74.0060"
              disabled={disabled}
              step="any"
              min={-180}
              max={180}
              className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-[var(--text-primary)] ${
                error || !isLonValid
                  ? "border-red-500"
                  : "border-[var(--border-main)]"
              }`}
            />
            {!isLonValid && (
              <div className="mt-1 text-xs text-red-600">
                Must be between -180 and 180
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clear Button */}
      {(address || lat || lon) && (
        <div className="flex justify-end">
          <button
            onClick={handleClear}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
