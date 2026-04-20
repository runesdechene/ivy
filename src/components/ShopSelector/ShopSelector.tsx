'use client';

import { Menu, Button, Text, Group, Badge } from '@mantine/core';
import { IconChevronDown, IconBuilding, IconPlus } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useRouter } from 'next/navigation';

export function ShopSelector() {
  const { currentShop, shops, setCurrentShop, loading } = useShop();
  const router = useRouter();

  if (loading) {
    return (
      <Button variant="subtle" color="gray" size="sm" loading>
        Chargement...
      </Button>
    );
  }

  if (!currentShop) {
    return (
      <Button 
        variant="light" 
        size="sm"
        leftSection={<IconPlus size={16} />}
        onClick={() => router.push('/onboarding')}
      >
        Ajouter une boutique
      </Button>
    );
  }

  return (
    <Menu shadow="md" width={250}>
      <Menu.Target>
        <Button 
          variant="subtle" 
          color="gray" 
          size="sm"
          rightSection={<IconChevronDown size={14} />}
        >
          <Group gap="xs">
            <IconBuilding size={16} />
            <Text size="sm" fw={500}>{currentShop.name}</Text>
          </Group>
        </Button>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>Mes boutiques</Menu.Label>
        {shops.map((shop) => (
          <Menu.Item
            key={shop.id}
            leftSection={<IconBuilding size={14} />}
            rightSection={shop.id === currentShop.id ? <Badge size="xs" color="moss">Active</Badge> : null}
            onClick={() => setCurrentShop(shop)}
          >
            {shop.name}
          </Menu.Item>
        ))}
        
        <Menu.Divider />
        
        <Menu.Item
          leftSection={<IconPlus size={14} />}
          onClick={() => router.push('/onboarding?add=true')}
        >
          Ajouter une boutique
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
