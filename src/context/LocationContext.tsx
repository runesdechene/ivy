'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useShop } from './ShopContext';

export interface ShopifyLocation {
  id: string;
  name: string;
  address1?: string;
  city?: string;
  country?: string;
  active: boolean;
}

interface LocationContextType {
  currentLocation: ShopifyLocation | null;
  locations: ShopifyLocation[];
  loading: boolean;
  setCurrentLocation: (location: ShopifyLocation) => void;
  refreshLocations: () => Promise<void>;
}

const LocationContext = createContext<LocationContextType>({
  currentLocation: null,
  locations: [],
  loading: true,
  setCurrentLocation: () => {},
  refreshLocations: async () => {},
});

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { currentShop } = useShop();
  const [currentLocation, setCurrentLocationState] = useState<ShopifyLocation | null>(null);
  const [locations, setLocations] = useState<ShopifyLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshLocations = useCallback(async () => {
    if (!currentShop) {
      setLocations([]);
      setCurrentLocationState(null);
      setLoading(false);
      return;
    }

    const shopId = currentShop.id;
    const pickDefault = (list: ShopifyLocation[]): ShopifyLocation | null => {
      if (list.length === 0) return null;
      const savedId = localStorage.getItem(`ivy_location_${shopId}`);
      return list.find((l) => l.id === savedId) || list[0];
    };

    // Hydratation IMMÉDIATE depuis le cache : évite d'attendre le round-trip Shopify
    // (/api/locations appelle Shopify en direct, ~500ms+) à chaque chargement. La liste
    // est ensuite rafraîchie en arrière-plan.
    let hydrated = false;
    try {
      const cached = localStorage.getItem(`ivy_locations_${shopId}`);
      if (cached) {
        const list: ShopifyLocation[] = JSON.parse(cached);
        if (Array.isArray(list) && list.length > 0) {
          setLocations(list);
          setCurrentLocationState((prev) => prev ?? pickDefault(list));
          setLoading(false);
          hydrated = true;
        }
      }
    } catch {
      /* cache illisible → on ignore */
    }

    if (!hydrated) setLoading(true);

    try {
      const response = await fetch(`/api/locations?shopId=${shopId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch locations');
      }

      const data = await response.json();
      const activeLocations: ShopifyLocation[] = data.locations.filter(
        (loc: ShopifyLocation) => loc.active,
      );

      setLocations(activeLocations);
      try {
        localStorage.setItem(`ivy_locations_${shopId}`, JSON.stringify(activeLocations));
      } catch {
        /* quota → on ignore */
      }

      // Conserver la sélection courante si elle existe toujours ; sinon défaut.
      setCurrentLocationState((prev) => {
        if (prev && activeLocations.some((l) => l.id === prev.id)) return prev;
        return pickDefault(activeLocations);
      });
    } catch (error) {
      console.error('Error loading locations:', error);
      if (!hydrated) setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    refreshLocations();
  }, [refreshLocations]);

  const setCurrentLocation = useCallback((location: ShopifyLocation) => {
    setCurrentLocationState(location);
    
    // Sauvegarder dans localStorage
    if (currentShop) {
      localStorage.setItem(`ivy_location_${currentShop.id}`, location.id);
    }
  }, [currentShop]);

  return (
    <LocationContext.Provider value={{ 
      currentLocation, 
      locations, 
      loading, 
      setCurrentLocation, 
      refreshLocations,
    }}>
      {children}
    </LocationContext.Provider>
  );
}

export const useLocation = () => useContext(LocationContext);
