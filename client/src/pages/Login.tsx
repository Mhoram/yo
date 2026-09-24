export function Login() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-4xl font-bold">yo</h1>
      <p className="max-w-sm text-center text-muted-foreground">
        Your personal inbox, with a gatekeeper, and Yobox / Receipts / Feed instead of one pile of mail.
      </p>
      <a
        href="/auth/google"
        className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Sign in with Google
      </a>
    </div>
  );
}
