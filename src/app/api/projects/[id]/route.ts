import { handler, ok } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { loadProjectDetail } from '@/lib/projects';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, id);

  return ok({ detail: await loadProjectDetail(ctx, id) });
});
