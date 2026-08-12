import { randomUUID } from 'crypto';
import {
  ApiError,
  forbidden,
  handler,
  ok,
  optionalString,
  readJson,
  requireString,
} from '@/lib/api';
import { requireSession, type Ctx } from '@/lib/auth/guards';
import { AVATAR_BUCKET, signAvatar } from '@/lib/avatars';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Ziel =
  | { tabelle: 'admins'; spalte: 'user_id'; id: string; ordner: string }
  | { tabelle: 'suppliers'; spalte: 'id'; id: string; ordner: string };

/**
 * Wessen Bild darf der Angemeldete ändern?
 *
 * Ohne supplierId immer das eigene. Mit supplierId das eines Lieferanten – das
 * darf der Bauherrenvertreter, der die Kartei führt, und der Lieferant bei sich
 * selbst. Fremde Bauherrenvertreter kann niemand ändern.
 */
function zielBestimmen(ctx: Ctx, supplierId: string | null): Ziel {
  if (supplierId) {
    if (ctx.session.kind === 'supplier' && ctx.session.supplierId !== supplierId) {
      throw forbidden('Du kannst nur dein eigenes Profilbild ändern.');
    }
    return {
      tabelle: 'suppliers',
      spalte: 'id',
      id: supplierId,
      ordner: `suppliers/${supplierId}`,
    };
  }

  if (ctx.session.kind === 'supplier') {
    return {
      tabelle: 'suppliers',
      spalte: 'id',
      id: ctx.session.supplierId,
      ordner: `suppliers/${ctx.session.supplierId}`,
    };
  }

  return {
    tabelle: 'admins',
    spalte: 'user_id',
    id: ctx.session.userId,
    ordner: `admins/${ctx.session.userId}`,
  };
}

async function bisherigerPfad(ziel: Ziel): Promise<string | null> {
  const { data } = await serviceClient()
    .from(ziel.tabelle)
    .select('avatar_path')
    .eq(ziel.spalte, ziel.id)
    .maybeSingle();

  return (data as { avatar_path?: string | null } | null)?.avatar_path ?? null;
}

/** Schritt 1: Upload vorbereiten. Der Browser lädt danach direkt in den Speicher. */
export const POST = handler(async (request: Request) => {
  const ctx = await requireSession();
  const body = await readJson<{ supplierId?: string }>(request);
  const ziel = zielBestimmen(ctx, optionalString(body.supplierId, 64));

  // Zufälliger Name pro Upload, damit ein ausgetauschtes Bild nicht aus dem
  // Zwischenspeicher des Browsers kommt.
  const pfad = `${ziel.ordner}/${randomUUID()}.jpg`;

  const upload = await serviceClient()
    .storage.from(AVATAR_BUCKET)
    .createSignedUploadUrl(pfad);

  if (upload.error) {
    throw new ApiError(
      `Upload konnte nicht vorbereitet werden: ${upload.error.message}. ` +
        `Existiert der Speicher "${AVATAR_BUCKET}" (Migration 0005)?`,
      500,
    );
  }

  return ok({ bucket: AVATAR_BUCKET, path: pfad, token: upload.data.token });
});

/** Schritt 2: Nach dem Upload den Pfad übernehmen und das alte Bild entfernen. */
export const PUT = handler(async (request: Request) => {
  const ctx = await requireSession();
  const body = await readJson<{ supplierId?: string; path?: string }>(request);
  const ziel = zielBestimmen(ctx, optionalString(body.supplierId, 64));
  const pfad = requireString(body.path, 'Pfad', 300);

  if (!pfad.startsWith(`${ziel.ordner}/`)) {
    throw new ApiError('Der gemeldete Pfad gehört nicht zu diesem Profil.', 400);
  }

  const alt = await bisherigerPfad(ziel);

  const { error } = await serviceClient()
    .from(ziel.tabelle)
    .update({ avatar_path: pfad })
    .eq(ziel.spalte, ziel.id);

  if (error) {
    throw new ApiError(`Profilbild konnte nicht gespeichert werden: ${error.message}`, 500);
  }

  if (alt && alt !== pfad) {
    await serviceClient().storage.from(AVATAR_BUCKET).remove([alt]);
  }

  return ok({ avatar_url: await signAvatar(pfad) });
});

/** Bild entfernen – die Ansicht zeigt danach wieder die Initialen. */
export const DELETE = handler(async (request: Request) => {
  const ctx = await requireSession();
  const supplierId = new URL(request.url).searchParams.get('supplierId');
  const ziel = zielBestimmen(ctx, supplierId);

  const alt = await bisherigerPfad(ziel);

  const { error } = await serviceClient()
    .from(ziel.tabelle)
    .update({ avatar_path: null })
    .eq(ziel.spalte, ziel.id);

  if (error) {
    throw new ApiError(`Profilbild konnte nicht entfernt werden: ${error.message}`, 500);
  }

  if (alt) await serviceClient().storage.from(AVATAR_BUCKET).remove([alt]);

  return ok({ ok: true });
});
