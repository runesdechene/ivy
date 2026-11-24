# Met toutes les photos d'un modèle à la même taille, face par face, en les recalant sur la photo Noir.
#   python scripts/gabarits/aligner.py "<dossier>" <Modèle>        → rapport des tailles, rien n'est écrit
#   python scripts/gabarits/aligner.py "<dossier>" <Modèle> --ecrire → remplace les fichiers recalés
# Noms attendus : "<Modèle> <Couleur>.png" (recto) et "<Modèle> <Couleur> Verso.png".
# Le décalage retenu est celui qui superpose le mieux les silhouettes (zones opaques) à celle du Noir.
import sys, os, glob
import numpy as np
from PIL import Image

dossier, modele = sys.argv[1], sys.argv[2]
ecrire = '--ecrire' in sys.argv
sys.stdout.reconfigure(encoding="utf-8")

def silhouette(im):
    return np.asarray(im.getchannel('A')) > 127

def meilleur_decalage(a, ref, marge=20):
    H, W = ref.shape; h, w = a.shape
    meilleur = (-1.0, 0, 0)
    for dy in range(-marge, marge + 1):
        for dx in range(-marge, marge + 1):
            y0, x0, y1, x1 = max(0, dy), max(0, dx), min(H, dy + h), min(W, dx + w)
            if y1 <= y0 or x1 <= x0: continue
            inter = np.logical_and(a[y0 - dy:y1 - dy, x0 - dx:x1 - dx], ref[y0:y1, x0:x1]).sum()
            iou = inter / (ref.sum() + a.sum() - inter)
            if iou > meilleur[0]: meilleur = (iou, dx, dy)
    return meilleur

for face, motif in (('recto', f'{modele} *.png'), ('verso', f'{modele} * Verso.png')):
    photos = [p for p in sorted(glob.glob(os.path.join(dossier, motif))) if (face == 'verso') == p.endswith(' Verso.png')]
    noir = os.path.join(dossier, f'{modele} Noir{" Verso" if face == "verso" else ""}.png')
    ref_im = Image.open(noir).convert('RGBA'); ref = silhouette(ref_im)
    print(f'{face} : référence Noir {ref_im.size[0]}×{ref_im.size[1]}')
    for p in photos:
        im = Image.open(p).convert('RGBA')
        if im.size == ref_im.size:
            print(f'  = {os.path.basename(p)}'); continue
        iou, dx, dy = meilleur_decalage(silhouette(im), ref)
        print(f'  ~ {os.path.basename(p)} {im.size[0]}×{im.size[1]} → décalage ({dx}, {dy}), recouvrement {iou:.1%}')
        assert iou > 0.95, 'silhouettes trop différentes : à vérifier à la main'
        if ecrire:
            toile = Image.new('RGBA', ref_im.size, (0, 0, 0, 0)); toile.paste(im, (dx, dy))
            toile.save(p, optimize=True)
