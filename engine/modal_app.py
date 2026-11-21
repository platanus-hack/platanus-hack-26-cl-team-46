"""Fallback del motor en Modal (cuando Render no esté disponible / cómputo on-demand).

Levanta el MISMO contenedor del motor como función serverless. Las keys de la
cascada LLM van como secrets de Modal, no en el código.

    modal deploy engine/modal_app.py

Luego: POST al endpoint web que Modal expone, con el mismo body que /run.
"""
import modal

# Reusa el Dockerfile del motor (mismo contenedor que en Render).
image = modal.Image.from_dockerfile("engine/Dockerfile")
app = modal.App("hack26-engine")


@app.function(
    image=image,
    timeout=900,
    secrets=[modal.Secret.from_name("hack26-llm-keys")],  # ANTHROPIC/DEEPSEEK/GLM
)
@modal.web_server(8080, startup_timeout=60)
def engine():
    # El contenedor ya arranca `node src/server.ts` (CMD del Dockerfile).
    # web_server expone el :8080 del motor. POST /run con el EngagementSpec.
    pass
