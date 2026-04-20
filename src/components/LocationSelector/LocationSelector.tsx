'use client';

import { Menu, Button, Text, Group, Badge, Loader } from '@mantine/core';
import { IconChevronDown, IconMapPin } from '@tabler/icons-react';
import { useLocation } from '@/context/LocationContext';

export function LocationSelector() {
  const { currentLocation, locations, setCurrentLocation, loading } = useLocation();

  if (loading) {
    return (
      <Button variant="subtle" color="gray" size="sm" disabled>
        <Loader size="xs" mr="xs" />
        Chargement...
      </Button>
    );
  }

  if (locations.length === 0) {
    return (
      <Button variant="subtle" color="gray" size="sm" disabled>
        <IconMapPin size={16} style={{ marginRight: 8 }} />
        Aucun emplacement
      </Button>
    );
  }

  if (locations.length === 1) {
    return (
      <Button variant="subtle" color="gray" size="sm" disabled>
        <IconMapPin size={16} style={{ marginRight: 8 }} />
        {currentLocation?.name || 'Emplacement'}
      </Button>
    );
  }

  return (
    <Menu shadow="md" width={250}>
      <Menu.Target>
        <Button 
          variant="light" 
          color="moss" 
          size="sm"
          rightSection={<IconChevronDown size={14} />}
        >
          <Group gap="xs">
            <IconMapPin size={16} />
            <Text size="sm" fw={500}>{currentLocation?.name || 'Sélectionner'}</Text>
          </Group>
        </Button>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>Emplacements</Menu.Label>
        {locations.map((location) => (
          <Menu.Item
            key={location.id}
            leftSection={<IconMapPin size={14} />}
            rightSection={location.id === currentLocation?.id ? <Badge size="xs" color="moss">Actif</Badge> : null}
            onClick={() => setCurrentLocation(location)}
          >
            <div>
              <Text size="sm">{location.name}</Text>
              {location.city && (
                <Text size="xs" c="dimmed">{location.city}</Text>
              )}
            </div>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
