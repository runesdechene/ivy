'use client';

import { useState } from 'react';
import { Stack, PasswordInput, Button, Group, Divider } from '@mantine/core';
import { IconCheck, IconLogout } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';
import styles from './profil.module.scss';

export default function ProfilPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
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

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Profil &middot; Runes de Ch&ecirc;ne</p>
        <h1 className={styles.title}>Mon profil</h1>
      </div>

      <Stack gap="lg" maw={500}>
        <div className={styles.card}>
          <h3 className={styles.sectionTitle}>Informations</h3>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Email</span>
            <span className={styles.infoValue}>{user?.email || '\u2014'}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Compte cr&eacute;&eacute; le</span>
            <span className={styles.infoValue}>
              {user?.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR') : '\u2014'}
            </span>
          </div>
        </div>

        <div className={styles.card}>
          <h3 className={styles.sectionTitle}>Changer le mot de passe</h3>
          <Divider color="var(--divider)" mb="md" />
          <Stack gap="sm">
            <PasswordInput
              label="Mot de passe actuel"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Entrez votre mot de passe actuel"
              classNames={{ root: styles.input }}
            />
            <PasswordInput
              label="Nouveau mot de passe"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Au moins 6 caractères"
              classNames={{ root: styles.input }}
            />
            <PasswordInput
              label="Confirmer le nouveau mot de passe"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Retapez le nouveau mot de passe"
              classNames={{ root: styles.input }}
            />
            <Group justify="flex-end" mt="xs">
              <Button
                onClick={handleChangePassword}
                loading={saving}
                disabled={!newPassword || !confirmPassword}
                styles={{
                  root: {
                    backgroundColor: 'var(--slate)',
                    color: 'var(--cream-soft)',
                    fontFamily: 'var(--font-inter)',
                    fontSize: 13,
                    fontWeight: 500,
                    borderRadius: 6,
                    height: 38,
                    border: 'none',
                  },
                }}
              >
                Modifier le mot de passe
              </Button>
            </Group>
          </Stack>
        </div>

        <div className={styles.card}>
          <h3 className={styles.sectionTitle}>Session</h3>
          <Divider color="var(--divider)" mb="md" />
          <Button
            onClick={handleSignOut}
            leftSection={<IconLogout size={16} />}
            styles={{
              root: {
                backgroundColor: 'rgba(160, 75, 61, 0.08)',
                color: 'var(--rust)',
                fontFamily: 'var(--font-inter)',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 6,
                height: 38,
                border: 'none',
              },
            }}
          >
            D&eacute;connexion
          </Button>
        </div>
      </Stack>
    </div>
  );
}
