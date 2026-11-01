import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import bigInt from 'big-integer';

// Клієнт кешуємо в globalThis, щоб "теплий" інстанс Vercel не логінився щоразу заново.
const g = globalThis as unknown as { tgClient?: Promise<TelegramClient> };

function getClient(): Promise<TelegramClient> {
  if (!g.tgClient) {
    const { TG_API_ID, TG_API_HASH, TG_SESSION } = process.env;
    if (!TG_API_ID || !TG_API_HASH || !TG_SESSION) {
      throw new Error('Не задані TG_API_ID / TG_API_HASH / TG_SESSION');
    }
    g.tgClient = (async () => {
      const client = new TelegramClient(new StringSession(TG_SESSION), Number(TG_API_ID), TG_API_HASH, {
        connectionRetries: 3,
      });
      client.setLogLevel('error' as never);
      await client.connect();
      return client;
    })().catch((e) => {
      g.tgClient = undefined;
      throw e;
    });
  }
  return g.tgClient;
}

export interface TgLookup {
  exists: boolean;
  phone: string;
  id?: string;
  username?: string | null;
  name?: string | null;
  link?: string;
}

/** phone — лише цифри з кодом країни, напр. 380671234567 */
export async function lookupPhone(phone: string): Promise<TgLookup> {
  const client = await getClient();

  // Тимчасово імпортуємо номер у контакти — Telegram повертає користувача, якщо він існує
  // і його налаштування приватності дозволяють знайти його за номером.
  const res = await client.invoke(
    new Api.contacts.ImportContacts({
      contacts: [
        new Api.InputPhoneContact({
          clientId: bigInt(Math.floor(Math.random() * 1e15)),
          phone: '+' + phone,
          firstName: 'check',
          lastName: '',
        }),
      ],
    })
  );

  const user = res.users.find((u): u is Api.User => u instanceof Api.User);
  if (!user) return { exists: false, phone };

  // Прибираємо тимчасовий контакт
  try {
    await client.invoke(new Api.contacts.DeleteContacts({ id: [user] }));
  } catch {
    /* не критично */
  }

  const username = user.username ?? user.usernames?.find((u) => u.active)?.username ?? null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  const id = user.id.toString();

  return {
    exists: true,
    phone,
    id,
    username,
    name,
    link: username ? `https://t.me/${username}` : `tg://user?id=${id}`,
  };
}
