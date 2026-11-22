"""Despliegue PRIMARIO del motor en Modal.

Modal es el primario porque el motor usa herramientas (semgrep y, a futuro,
nuclei/ARTEX) que necesitan estar en la imagen: Modal construye el contenedor de
forma declarativa (sin Docker-in-Docker). Render queda como FALLBACK (render.yaml).

Reusa la MISMA imagen del motor (engine/Dockerfile), que ya hornea semgrep.
Las keys de la cascada LLM van como secret de Modal, nunca en el código.

    modal secret create hack26-llm-keys ANTHROPIC_API_KEY=... DEEPSEEK_API_KEY=... GLM_API_KEY=...
    modal deploy engine/modal_app.py
"""
import modal

image = modal.Image.from_dockerfile("engine/Dockerfile")
app = modal.App("hack26-engine")


@app.function(
    image=image,
    timeout=900,
    secrets=[modal.Secret.from_name("hack26-llm-keys")],  # ANTHROPIC/DEEPSEEK/GLM
)
@modal.web_server(8080, startup_timeout=120)
def engine():
    # El contenedor ya arranca `node src/server.ts` (CMD del Dockerfile);
    # web_server expone el :8080. POST /run con el EngagementSpec.
    pass
