# Mayday

**Simulador de hackeos para developers.** Atacamos tu propia app en un sandbox y vives el incidente en tiempo real.

## Cómo funciona

1. **Entregas tu repo.** Un agente de IA lo analiza y lo despliega en un sandbox aislado en Render, con base de datos, migraciones y usuarios de prueba.
2. **Te hackean.** Una IA encuentra las vulnerabilidades de tu código y un agente atacante las explota una por una.
3. **Vives el incidente.** Te llegan correos de clientes enojados y alertas de Sentry y Datadog. Respondes conversando con tu agente de código, y cada acción cambia la app desplegada de verdad.
4. **Sin atajos.** Después de cada cambio volvemos a probar el exploit. Si cambias la contraseña robada pero no rotas el `JWT_SECRET`, el atacante sigue adentro.
5. **Debrief.** Al final ves qué pasó, dónde estaba el error, cuál era el fix correcto y cómo se compara con un caso real.

## Por qué

Ningún developer quiere que su primer incidente de seguridad sea en producción. Mayday te deja equivocarte en un ambiente seguro, con tu propio código.

Es una herramienta defensiva y educativa: solo se atacan apps desplegadas en nuestro sandbox.

👉 **Pruébalo en [mayday.rip](https://mayday.rip)**
