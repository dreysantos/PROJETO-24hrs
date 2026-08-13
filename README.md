# Sistema Mecatrônico Social de Baixo Custo

Painel de monitoramento em tempo real para um sistema mecatrônico social de baixo custo, com controle inteligente de água, energia solar e bateria. O projeto usa Arduino, Node.js e uma interface web responsiva para demonstrar aplicação em escolas, organizações comunitárias, pequenas empresas, associações, hortas comunitárias, cooperativas e outros espaços coletivos.

## Recursos

- Monitoramento em tempo real com atualização a cada segundo.
- Painel visual com barras de nível, bateria, corrente e placa solar.
- Histórico recente em gráfico no navegador.
- Relatórios com médias, máximos, mínimos e contagem de alertas.
- Exportação de leituras em CSV.
- Tela dedicada de alertas.
- Documentação do protótipo completo com reservatórios, alimentação solar, bateria, controlador de carga, conectores, fusível e montagem soldada.
- Modo simulação automático quando o Arduino não está conectado ou quando o projeto roda em nuvem.
- Página de diagnóstico do servidor e da conexão serial.
- Validação dos dados recebidos do Arduino.
- Interface responsiva com suporte a modo claro e escuro.

## Requisitos

- Node.js 14 ou superior.
- npm.
- Arduino enviando JSON por USB serial, quando usado em modo local.

## Como iniciar

```bash
npm install
npm start
```

Acesse:

```text
http://localhost:3000
```

## Configuração

Crie ou edite o arquivo `.env`:

```env
PORTA_SITE=3000
PORTA_ARDUINO=COM3
BAUD_RATE=9600
MODO_CLOUD=false
SIMULACAO_AUTOMATICA=true
MODO_OPERACAO=automatico
CORS_ORIGEM=
LIMITE_HISTORICO=60
LIMITE_REQUISICOES=120
JANELA_TEMPO_MS=60000
DIAGNOSTICO_TOKEN=
DADOS_PUBLICOS=true
TRUST_PROXY=false
BANCO_ATIVO=true
BANCO_ARQUIVO=./data/leituras.jsonl
SALVAR_SIMULADOS=true
INTERVALO_GRAVACAO_MS=5000
URL_PUBLICA=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_TABELA=leituras
```

Para publicação em nuvem, use:

```env
MODO_CLOUD=true
SIMULACAO_AUTOMATICA=true
```

## Formato enviado pelo Arduino

O Arduino deve enviar uma linha JSON por leitura:

```json
{
  "nivel": "CHEIO",
  "bomba": "DESLIGADA",
  "corrente": 1.23,
  "tensaoBateria": 12.5,
  "cargaBateria": 85,
  "tensaoSolar": 18.2,
  "alerta": "NORMAL"
}
```

Valores esperados:

| Campo | Valores |
| --- | --- |
| `nivel` | `CHEIO`, `MEDIO`, `BAIXO`, `INDEFINIDO` |
| `bomba` | `LIGADA`, `DESLIGADA`, `PAUSADA`, `INDEFINIDO` |
| `corrente` | número entre 0 e 30 |
| `tensaoBateria` | número entre 0 e 30 |
| `cargaBateria` | número entre 0 e 100 |
| `tensaoSolar` | número entre 0 e 40 |
| `alerta` | texto curto, como `NORMAL`, `BATERIA BAIXA` ou `CORRENTE ALTA` |

O servidor também gera automaticamente um `tokenAcesso` com base no horário da leitura atual. Esse token muda quando uma nova leitura chega e aparece nas telas de consulta para copiar ou abrir links diretos.

## Pinagem documentada no TCC

| Função | Pinos |
| --- | --- |
| Sensores de nível baixo, médio e alto | `D2`, `D3`, `D4` |
| Relé da bomba | `D7` |
| LEDs verde, amarelo e vermelho | `D8`, `D9`, `D10` |
| Buzzer | `D11` |
| Sensor de corrente ACS712 | `A0` |
| Sensor de tensão da bateria | `A1` |
| Sensor de tensão da placa solar | `A2` |
| Displays LCD I2C | `A4` e `A5` |

## Rotas

- `GET /dados`: leitura atual. Em cloud/offline pode retornar dados simulados. Pode ser protegido com `DADOS_PUBLICOS=false`.
- `GET /modo`: mostra o modo atual do painel.
- `POST /modo`: altera entre `automatico`, `simulacao` e `arduino`.
- `GET /historico`: últimas leituras armazenadas.
- `GET /token-acesso`: código gerado pelo horário da leitura atual e links diretos com `?token=` no modo demonstração.
- `GET /leituras`: últimas leituras salvas no banco local. Aceita `?limite=100` e exige código de consulta em `?token=`.
- `GET /relatorio`: indicadores consolidados das leituras. Aceita `?periodo=hoje`, `?periodo=24h` ou `?periodo=7d`.
- `GET /alertas`: leituras consideradas críticas ou de atenção.
- `GET /exportar.csv`: exporta leituras em CSV.
- `GET /rede`: mostra o IP local e links para acessar o painel e as leituras em outro dispositivo. Exige token fixo quando `DIAGNOSTICO_TOKEN` está ativo.
- `GET /saude`: status simples do servidor.
- `GET /diagnostico`: status detalhado do servidor, Arduino, memória e histórico. Exige token em `?token=`.

## Banco de dados local

Se `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estiverem configurados, as leituras são salvas no Supabase. Se não estiverem, o sistema usa o banco local em arquivo JSON Lines, por padrão em:

```text
data/leituras.jsonl
```

Cada linha do arquivo representa uma leitura completa com data ISO, horário local, nível de água, bomba, corrente, bateria, placa solar, alerta, conexão e indicação se a leitura foi simulada.

Configurações disponíveis:

```env
BANCO_ATIVO=true
BANCO_ARQUIVO=./data/leituras.jsonl
SALVAR_SIMULADOS=true
INTERVALO_GRAVACAO_MS=5000
```

Para consultar as leituras salvas:

```text
/leituras?limite=100
```

## Banco online com Supabase

O projeto já inclui os arquivos prontos:

- `supabase/schema.sql`: cria a tabela `leituras`.
- `SUPABASE_SETUP.md`: passo a passo para configurar no Supabase e no Render.
- `.env.example`: modelo de variáveis de ambiente.

Crie uma tabela no Supabase usando este SQL:

```sql
create table if not exists leituras (
  id bigserial primary key,
  data_iso timestamptz not null default now(),
  horario text,
  nivel text,
  bomba text,
  corrente numeric,
  tensao_bateria numeric,
  carga_bateria numeric,
  tensao_solar numeric,
  alerta text,
  conexao text,
  simulado boolean default false,
  created_at timestamptz not null default now()
);

create index if not exists leituras_data_iso_idx on leituras (data_iso desc);
```

Depois configure no `.env` local ou nas variáveis da hospedagem:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
SUPABASE_TABELA=leituras
BANCO_ATIVO=true
```

Use a chave `service_role` apenas no servidor. Não coloque essa chave em arquivos públicos do site.

Para acessar pelo celular, deixe o celular na mesma rede Wi-Fi do computador e abra a página:

```text
/leituras.html
```

Essa página mostra automaticamente o link completo de rede, como `http://192.168.0.10:3000/leituras.html`.

Se o celular não estiver na mesma rede, o IP local não funciona. Nesse caso, publique o projeto em uma hospedagem como Render ou Railway e configure:

```env
URL_PUBLICA=https://seu-site.onrender.com
MODO_CLOUD=true
```

Depois acesse:

```text
https://seu-site.onrender.com/leituras.html
```

## Páginas

- `/index.html`: visão inicial.
- `/painel.html`: painel em tempo real.
- `/leituras.html`: consulta visual das leituras salvas no banco.
- `/relatorios.html`: indicadores consolidados do histórico.
- `/alertas.html`: eventos importantes e condições de atenção.
- `/lcd.html`: representação do LCD.
- `/funcionamento.html`: explicação do fluxo.
- `/componentes.html`: lista de componentes.
- `/simulacao.html`: estados simulados e conexões.
- `/diagnostico.html`: diagnóstico visual do servidor.
- `/sobre.html`: informações do projeto.

## Publicação

O projeto já está preparado para serviços como Render. O arquivo `render.yaml` usa `npm start`, e o modo cloud pode ser ativado com a variável `MODO_CLOUD=true`.

## Segurança

O servidor aplica headers de proteção, CSP, bloqueio de iframe, bloqueio de métodos diferentes de `GET`, `HEAD` e `OPTIONS`, limite de requisições por IP e validação das leituras recebidas pela serial.

Para restringir CORS em produção, informe uma lista separada por vírgula:

```env
CORS_ORIGEM=https://seu-site.com,https://outro-dominio.com
```

As telas de leituras, relatórios, alertas e diagnóstico exibem automaticamente um código de consulta gerado pelo horário da leitura atual. Esse modo é útil para demonstração local e apresentação.

Exemplo:

```text
/diagnostico.html?token=TCC-220526-092346
```

Para um site publicado na internet, configure um token fixo. Com `DIAGNOSTICO_TOKEN` ativo, somente esse código fixo consegue alterar o modo do painel, consultar leituras, gerar relatórios, ver alertas, exportar CSV, abrir diagnóstico e acessar informações de rede.

```env
DIAGNOSTICO_TOKEN=troque-este-token
```

Com token fixo ativo, acesse a página visual assim:

```text
/diagnostico.html?token=troque-este-token
```

Para impedir que visitantes vejam até a leitura atual em `/dados`, use:

```env
DADOS_PUBLICOS=false
```

Nesse modo, abra o painel com o token fixo na URL, por exemplo:

```text
/painel.html?token=troque-este-token
```

Em hospedagens atrás de proxy HTTPS, como algumas plataformas cloud, ative:

```env
TRUST_PROXY=true
```
