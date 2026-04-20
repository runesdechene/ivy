'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TextInput, Button, Stack, PasswordInput } from '@mantine/core';
import { IvyMark } from '@/components/IvyMark';
import styles from '../login/login.module.scss';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setLoading(true);

    try {
      const { error } = await signUp(email, password);
      if (error) {
        if (error.message.includes('already registered')) {
          setError('Cet email est déjà utilisé');
        } else {
          setError('Erreur lors de la création du compte');
        }
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push('/onboarding');
        }, 2000);
      }
    } catch (error) {
      setError('Erreur lors de la création du compte');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.markWrapper}>
          <IvyMark size="xl" withParent />
        </div>
        <p className={styles.subtitle}>Créer votre espace de production</p>

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>Compte créé avec succès ! Redirection...</p>}

        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <TextInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={success}
              classNames={{ root: styles.input }}
            />

            <PasswordInput
              label="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={success}
              classNames={{ root: styles.input }}
            />

            <PasswordInput
              label="Confirmer le mot de passe"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={success}
              classNames={{ root: styles.input }}
            />

            <Button
              type="submit"
              loading={loading}
              disabled={success}
              className={styles.submitBtn}
              mt="sm"
            >
              Créer mon compte
            </Button>
          </Stack>
        </form>

        <p className={styles.linkText}>
          Déjà un compte ?{' '}
          <Link href="/login">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
