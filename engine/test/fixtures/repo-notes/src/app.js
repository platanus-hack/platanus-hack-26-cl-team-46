// Repo de prueba: el código (resumido) de la app de notas que sirve test/fixture.ts.
// El motor descubre las rutas de aquí; no sabe nada más de la app.
const express = require('express');
const app = express();

app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/users/me', requireAuth, me);
app.patch('/api/users/me', requireAuth, updateMe);
app.post('/api/users/me/password', requireAuth, changePassword);
app.get('/api/notes', requireAuth, listNotes);
app.post('/api/notes', requireAuth, createNote);
app.get('/api/notes/:id', requireAuth, getNote);
app.delete('/api/notes/:id', requireAuth, deleteNote);
app.get('/api/admin/users', requireAuth, requireAdmin, adminUsers);
app.get('/api/admin/users/export', requireAuth, exportUsers);
app.post('/login', webLogin);
app.get('/notes/:id', requireLogin, noteView);

module.exports = app;
