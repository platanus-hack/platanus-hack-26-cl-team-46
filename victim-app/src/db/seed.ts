import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { logEvent } from '../lib/logger';

// Datos de ejemplo (personas y datos inventados)
const SEED_USERS = [
  {
    email: 'catalina.rojas@example.com',
    password: 'Apuntes-Admin-2026!',
    name: 'Catalina Rojas',
    phone: '+56 9 5550 1201',
    bio: 'Hice esta app para ordenar mis apuntes. Si algo falla, escríbeme.',
    role: 'admin',
    notes: [
      {
        title: 'Pendientes de la app',
        body: 'Agregar etiquetas a las notas.\nExportar notas a PDF.\nRevisar backups de la base.',
      },
      {
        title: 'Hosting',
        body: 'La app corre en Render. Base Postgres en el plan free, se borra a los 30 días: acordarse de migrar.',
      },
    ],
  },
  {
    email: 'martin.soto@example.com',
    password: 'qwerty123',
    name: 'Martín Soto',
    phone: '+56 9 5550 3344',
    bio: 'Estudiante de ingeniería. Uso Apuntes para todo.',
    role: 'user',
    notes: [
      {
        title: 'Datos para transferencias',
        body: 'Banco Ficticio de Chile\nCuenta corriente 00-000-12345-6\nRUT 11.111.111-1\nmartin.soto@example.com',
      },
      {
        title: 'Clave wifi depto',
        body: 'Red: DeptoSoto_5G\nClave: casa-de-martin-2024',
      },
      {
        title: 'Ramos del semestre',
        body: 'Cálculo III, Estructuras de Datos, Bases de Datos, Inglés IV',
      },
    ],
  },
  {
    email: 'javiera.munoz@example.com',
    password: 'Jm!8vQ2#rTz9',
    name: 'Javiera Muñoz',
    phone: '+56 9 5550 7788',
    bio: 'Diseñadora freelance.',
    role: 'user',
    notes: [
      {
        title: 'Clientes noviembre',
        body: 'Panadería Los Aromos: logo + carta (pagado 50%)\nCafé Brote: redes sociales\nContacto Café Brote: Pedro Lagos, +56 9 5550 2020',
      },
      {
        title: 'Médico',
        body: 'Control dermatología jueves 28, 10:30. Llevar exámenes.',
      },
    ],
  },
  {
    email: 'diego.fuentes@example.com',
    password: 'Df-2026-montaña-azul',
    name: 'Diego Fuentes',
    phone: '+56 9 5550 9911',
    bio: 'Backend dev. Me gusta el trekking.',
    role: 'user',
    notes: [
      {
        title: 'Viaje a Torres del Paine',
        body: 'Reserva refugio: código RES-0000-FAKE\nPasaporte: P0000000 (vence 2028)\nSeguro de viaje: póliza 000-111',
      },
      {
        title: 'Ideas side project',
        body: 'App para repartir gastos entre amigos. Ver si alguien más la quiere usar.',
      },
    ],
  },
  {
    email: 'fernanda.castillo@example.com',
    password: 'FerCast#2026*notas',
    name: 'Fernanda Castillo',
    phone: '+56 9 5550 4455',
    bio: null,
    role: 'user',
    notes: [
      {
        title: 'Dirección nueva',
        body: 'Av. Inventada 1234, depto 56, Providencia.\nConserje: Don Luis (+56 9 5550 0001)',
      },
    ],
  },
];

export async function seed(): Promise<void> {
  let created = 0;
  for (const u of SEED_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash, name, phone, bio, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [u.email, hash, u.name, u.phone, u.bio, u.role],
    );
    if (rows.length === 0) continue; // ya existía

    created++;
    for (const n of u.notes) {
      await pool.query('INSERT INTO notes (user_id, title, body) VALUES ($1, $2, $3)', [rows[0].id, n.title, n.body]);
    }
  }
  logEvent('seed_done', { users_created: created });
}
