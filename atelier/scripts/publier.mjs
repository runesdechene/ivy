// Publie la version construite par electron-builder dans le bucket public `atelier-versions`.
// L'installateur et son .blockmap d'abord, `latest.yml` en dernier : une application qui lit
// `latest.yml` trouve toujours l'installateur qu'il annonce.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

process.loadEnvFile(path.join(import.meta.dirname, '../../.env.local'));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { version } = JSON.parse(await readFile(path.join(import.meta.dirname, '../package.json'), 'utf8'));

const dossier = path.join(import.meta.dirname, '../dist-installer');
const installateur = `IVY-Atelier-Setup-${version}.exe`;

for (const nom of [installateur, `${installateur}.blockmap`, 'latest.yml']) {
  const reponse = await fetch(`${url}/storage/v1/object/atelier-versions/${nom}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'x-upsert': 'true', 'Content-Type': 'application/octet-stream' },
    body: await readFile(path.join(dossier, nom)),
  });
  if (!reponse.ok) throw new Error(`${nom} : ${reponse.status} ${await reponse.text()}`);
  console.info(`publié : ${nom}`);
}
