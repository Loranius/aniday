import { useState, type FormEvent } from 'react';
import { supabase } from '@/data/supabaseClient';
import { Banner, Button, Field, Input } from '@/ui/primitives';

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) setInfo('Перевірте пошту і підтвердіть реєстрацію, потім увійдіть.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        /invalid login credentials/i.test(msg)
          ? 'Невірний email або пароль'
          : /fetch|network/i.test(msg)
            ? 'Немає з’єднання з сервером'
            : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="safe-top mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="text-4xl">🚗</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Пробіг</h1>
        <p className="mt-1 text-muted">Історія авто, кілометраж і обслуговування — автоматично.</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Пароль" hint={mode === 'signup' ? 'Мінімум 6 символів' : undefined}>
          <Input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        {info && <Banner>{info}</Banner>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Зачекайте…' : mode === 'signin' ? 'Увійти' : 'Створити акаунт'}
        </Button>
      </form>
      <button
        className="mt-4 h-12 text-sm text-accent"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(null);
          setInfo(null);
        }}
      >
        {mode === 'signin' ? 'Немає акаунта? Зареєструватися' : 'Вже є акаунт? Увійти'}
      </button>
    </div>
  );
}
