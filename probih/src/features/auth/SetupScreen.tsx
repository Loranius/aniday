export function SetupScreen() {
  return (
    <div className="safe-top mx-auto max-w-lg px-5 py-10">
      <div className="text-4xl">🔧</div>
      <h1 className="mt-3 text-2xl font-semibold">Потрібно підключити Supabase</h1>
      <p className="mt-2 text-muted">
        Застосунок зберігає дані у вашому власному проєкті Supabase. Ключі не вшиті в код — додайте їх у файл <code>.env</code> і
        перезберіть застосунок.
      </p>
      <ol className="mt-6 list-decimal space-y-3 pl-5 text-[15px]">
        <li>Створіть проєкт на supabase.com.</li>
        <li>
          Застосуйте міграції з <code>supabase/migrations</code> (SQL Editor або <code>supabase db push</code>).
        </li>
        <li>
          Скопіюйте <code>.env.example</code> у <code>.env</code> і вкажіть <code>VITE_SUPABASE_URL</code> та{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>.
        </li>
        <li>
          Зберіть застосунок: <code>npm run android:sync</code>.
        </li>
      </ol>
    </div>
  );
}
