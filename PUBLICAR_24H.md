# Publicar 24h fora da rede

Este projeto pode ficar online em uma hospedagem Node.js mesmo com o PC desligado usando o modo cloud.

## Importante

Com o PC desligado, o site continua aberto, mas o Arduino USB não envia leituras reais para a hospedagem. O painel mostrara o servidor online e o Arduino sem sinal.

Para receber dados reais com o PC desligado, use uma destas opcoes:

- Como melhoria futura, substituir a dependência da conexão USB com o computador por transmissão Wi-Fi utilizando ESP32, permitindo monitoramento sem fio.
- Usar Raspberry Pi ligado ao Arduino e a internet.
- Enviar dados do Arduino/PC para um banco online ou MQTT enquanto o PC estiver ligado.

## Render

1. Suba este projeto para o GitHub.
2. Entre em https://render.com.
3. Crie um novo Web Service usando o repositorio.
4. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Configure a variavel:
   - `MODO_CLOUD=true`

O arquivo `render.yaml` ja deixa essa configuracao pronta para Blueprint.

## Railway

1. Suba este projeto para o GitHub.
2. Entre em https://railway.app.
3. Crie um projeto a partir do repositorio.
4. Adicione a variavel:
   - `MODO_CLOUD=true`
5. O start command pode ficar como:
   - `npm start`

## Para ficar realmente sempre ligado

Hospedagens gratuitas podem "dormir" quando ninguem acessa. Para ficar 24h de verdade, use um plano pago/barato de Render, Railway, Fly.io, VPS ou outro provedor Node.js.
