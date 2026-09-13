import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "IGI",
  robots: { index: false, follow: false },
};

// A plain HTML form: no client JS, so it works even if the bundle is stale, and
// the browser can save the password itself. Posting to /api/login sets the
// `igi_access` cookie and redirects to the chat.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-6">
      <form method="post" action="/api/login" className="w-full max-w-xs space-y-4">
        <div className="space-y-1">
          <h1 className="text-sm font-medium tracking-[0.3em] text-neutral-400 uppercase">IGI</h1>
          <p className="text-xs text-neutral-600">Idolatría del Gran Arquitecto Inteligente</p>
        </div>

        <input
          type="password"
          name="password"
          autoFocus
          required
          autoComplete="current-password"
          placeholder="Contraseña"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        />

        {e === "1" ? (
          <p className="text-xs text-red-400">Contraseña incorrecta.</p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
