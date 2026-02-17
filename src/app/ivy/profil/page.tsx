'use client';

import { useState } from 'react';
import { Title, Text, Paper, Stack, TextInput, PasswordInput, Button, Group, Divider } from '@mantine/core';
import { IconUser, IconLock, IconCheck } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/supabase/client';

export default function ProfilPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      notifications.show({
        title: 'Erreur',
        message: 'Veuillez remplir tous les champs',
        color: 'red',
      });
      return;
    }

    if (newPassword.length < 6) {
      notifications.show({
        title: 'Erreur',
        message: 'Le mot de passe doit contenir au moins 6 caractères',
        color: 'red',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      notifications.show({
        title: 'Erreur',
        message: 'Les mots de passe ne correspondent pas',
        color: 'red',
      });
      return;
    }

    setSaving(true);
    try {
      // Vérifier l'ancien mot de passe en se reconnectant
      if (currentPassword && user?.email) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        if (signInError) {
          notifications.show({
            title: 'Erreur',
            message: 'Mot de passe actuel incorrect',
            color: 'red',
          });
          setSaving(false);
          return;
        }
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        notifications.show({
          title: 'Erreur',
          message: error.message,
          color: 'red',
        });
      } else {
        notifications.show({
          title: 'Mot de passe modifié',
          message: 'Votre mot de passe a été mis à jour',
          color: 'green',
          icon: <IconCheck size={16} />,
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      console.error('Error updating password:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de modifier le mot de passe',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg" maw={500} mx="auto" mt="xl">
      <Group>
        <IconUser size={28} />
        <Title order={2}>Profil</Title>
      </Group>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="md">
          <Title order={4}>Informations</Title>
          <TextInput
            label="Email"
            value={user?.email || ''}
            disabled
          />
          <Text size="sm" c="dimmed">
            Compte créé le {user?.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR') : '—'}
          </Text>
        </Stack>
      </Paper>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="md">
          <Group>
            <IconLock size={20} />
            <Title order={4}>Changer le mot de passe</Title>
          </Group>
          <Divider />
          <PasswordInput
            label="Mot de passe actuel"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Entrez votre mot de passe actuel"
          />
          <PasswordInput
            label="Nouveau mot de passe"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Au moins 6 caractères"
          />
          <PasswordInput
            label="Confirmer le nouveau mot de passe"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Retapez le nouveau mot de passe"
          />
          <Group justify="flex-end">
            <Button
              onClick={handleChangePassword}
              loading={saving}
              disabled={!newPassword || !confirmPassword}
            >
              Modifier le mot de passe
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}
