import { assertNoError, handler, ok, readJson, optionalString, requireString } from '@/lib/api';
import { requireAdmin, requireSession } from '@/lib/auth/guards';
import { listProjects } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const ctx = await requireSession();
  return ok({ projects: await listProjects(ctx) });
});

export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();
  const body = await readJson<{ name?: string; ort?: string }>(request);

  const name = requireString(body.name, 'Projektname', 200);
  const ort = optionalString(body.ort, 200);

  const result = await ctx.db
    .from('projects')
    .insert({ name, ort })
    .select('id, name, ort, created_at')
    .single();

  assertNoError(result, 'Projekt konnte nicht angelegt werden');
  return ok({ project: result.data }, { status: 201 });
});
