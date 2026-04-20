'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TextInput, Button, Stack } from '@mantine/core';
import { IvyMark } from '@/components/IvyMark';
import styles from './login.module.scss';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error } = await signIn(email, password);
      if (error) {
        setError('Email ou mot de passe incorrect');
      } else {
        router.push('/');
      }
    } catch (error) {
      setError('Email ou mot de passe incorrect');
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
        <p className={styles.subtitle}>Gestion de production textile</p>

        {error && <p className={styles.error}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <TextInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              classNames={{ root: styles.input }}
            />

            <TextInput
              label="Mot de passe"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              classNames={{ root: styles.input }}
            />

            <Button
              type="submit"
              loading={loading}
              className={styles.submitBtn}
              mt="sm"
            >
              Se connecter
            </Button>
          </Stack>
        </form>

        <p className={styles.linkText}>
          Pas encore de compte ?{' '}
          <Link href="/signup">Cr&eacute;er un compte</Link>
        </p>
      </div>
    </div>
  );
}
