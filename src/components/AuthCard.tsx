export function Brand() {
  return (
    <a className="brand" href="/">
      Clair<span>.</span>
    </a>
  );
}

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Brand />
        <h2>{title}</h2>
        {children}
      </div>
    </main>
  );
}
