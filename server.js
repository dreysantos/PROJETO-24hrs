const express = require("express");
const path = require("path");
const os = require("os");
const fs = require("fs");
const https = require("https");
require("dotenv").config();

const app = express();
const PORTA_SITE = process.env.PORT || process.env.PORTA_SITE || 3000;
const PORTAS_ARDUINO = parsePortasArduino(process.env.PORTA_ARDUINO || process.env.PORTAS_ARDUINO || "COM3");
const BAUD_RATE = Number(process.env.BAUD_RATE) || 9600;
const MODO_CLOUD = process.env.MODO_CLOUD === "true";
const SIMULACAO_AUTOMATICA = process.env.SIMULACAO_AUTOMATICA !== "false";
const CORS_ORIGEM = process.env.CORS_ORIGEM || "";
const LIMITE_HISTORICO = Number(process.env.LIMITE_HISTORICO) || 60;
const LIMITE_REQUISICOES = Number(process.env.LIMITE_REQUISICOES) || 120;
const JANELA_TEMPO = Number(process.env.JANELA_TEMPO_MS) || 60000;
const DIAGNOSTICO_TOKEN = process.env.DIAGNOSTICO_TOKEN || "";
const DADOS_PUBLICOS = process.env.DADOS_PUBLICOS !== "false";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const CORS_PERMITIDOS = CORS_ORIGEM.split(",").map((origem) => origem.trim()).filter(Boolean);
const BANCO_ATIVO = process.env.BANCO_ATIVO !== "false";
const BANCO_ARQUIVO = process.env.BANCO_ARQUIVO || path.join(__dirname, "data", "leituras.jsonl");
const SALVAR_SIMULADOS = process.env.SALVAR_SIMULADOS !== "false";
const INTERVALO_GRAVACAO_MS = Number(process.env.INTERVALO_GRAVACAO_MS) || 5000;
const URL_PUBLICA = (process.env.URL_PUBLICA || "").replace(/\/$/, "");
const MODO_OPERACAO_INICIAL = process.env.MODO_OPERACAO || "automatico";

let ultimaLeituraReal = 0;
let ultimaGravacaoBanco = 0;
let reconexaoAgendada = false;
let portaSerial = null;
let filaBanco = Promise.resolve();
let modoOperacao = ["automatico", "simulacao", "arduino"].includes(MODO_OPERACAO_INICIAL) ? MODO_OPERACAO_INICIAL : "automatico";
let codigosConsultaRecentes = [];

let dadosArduino = criarDadosBase(MODO_CLOUD ? "cloud" : "offline");
let historico = [];

app.disable("x-powered-by");

if (TRUST_PROXY) {
    app.set("trust proxy", 1);
}

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Content-Security-Policy", [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
    ].join("; "));

    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    next();
});

app.use((req, res, next) => {
    if (req.method === "POST" && req.path === "/modo") {
        return next();
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        return res.status(405).json({ erro: "Metodo nao permitido" });
    }

    next();
});

app.use((req, res, next) => {
    const origem = req.headers.origin;
    const origemPermitida = !origem || CORS_PERMITIDOS.length === 0 || CORS_PERMITIDOS.includes(origem);

    if (!origemPermitida) {
        return res.status(403).json({ erro: "Origem nao permitida" });
    }

    if (origem && CORS_PERMITIDOS.includes(origem)) {
        res.header("Access-Control-Allow-Origin", origem);
        res.header("Vary", "Origin");
    }

    res.header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }
    next();
});

const requisicoes = {};

app.use((req, res, next) => {
    const ip = req.ip;
    const agora = Date.now();

    requisicoes[ip] = (requisicoes[ip] || []).filter((tempo) => agora - tempo < JANELA_TEMPO);

    if (requisicoes[ip].length >= LIMITE_REQUISICOES) {
        return res.status(429).json({ erro: "Muitas requisicoes. Tente novamente em alguns segundos." });
    }

    requisicoes[ip].push(agora);
    next();
});

setInterval(() => {
    const agora = Date.now();
    Object.keys(requisicoes).forEach((ip) => {
        requisicoes[ip] = requisicoes[ip].filter((tempo) => agora - tempo < JANELA_TEMPO);
        if (requisicoes[ip].length === 0) {
            delete requisicoes[ip];
        }
    });
}, JANELA_TEMPO).unref();

app.use(express.json({ limit: "10kb", strict: true }));
app.use(express.static(path.join(__dirname, "public"), {
    dotfiles: "ignore",
    etag: true,
    fallthrough: true,
    index: "index.html",
    maxAge: MODO_CLOUD ? "1h" : 0,
    setHeaders: (res, arquivo) => {
        if (arquivo.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-store");
        }
    }
}));

app.get("/:pagina.html", (req, res, next) => {
    const pagina = req.params.pagina;
    if (!/^[a-z0-9-]+$/i.test(pagina)) {
        return next();
    }

    const arquivoPagina = path.join(__dirname, "public", "pages", `${pagina}.html`);
    fs.access(arquivoPagina, fs.constants.R_OK, (erro) => {
        if (erro) {
            return next();
        }

        res.sendFile(arquivoPagina);
    });
});

function parsePortasArduino(valor) {
    return String(valor || "")
        .split(/[\s,]+/)
        .map((porta) => porta.trim())
        .filter(Boolean);
}

function listarPortasCandidatas(portasPreferidas, portasDisponiveis) {
    const portas = (portasDisponiveis || [])
        .map((porta) => String(porta || "").trim())
        .filter(Boolean);

    const preferidas = (portasPreferidas || [])
        .map((porta) => String(porta || "").trim())
        .filter(Boolean);

    const encontradas = preferidas.filter((porta) => portas.includes(porta));
    const restantes = portas.filter((porta) => !preferidas.includes(porta));
    return [...encontradas, ...restantes];
}

async function obterPortasDisponiveis() {
    try {
        const { SerialPort } = require("serialport");
        const portas = await SerialPort.list();
        return portas.map((porta) => String(porta.path || porta.portName || porta.comName || "").trim()).filter(Boolean);
    } catch (erro) {
        console.warn("Nao foi possivel listar portas seriais:", erro.message);
        return [];
    }
}

function criarDadosBase(conexao) {
    const agora = new Date();
    return {
        nivel: "AGUARDANDO",
        bomba: "AGUARDANDO",
        corrente: 0,
        tensaoBateria: 0,
        cargaBateria: 0,
        tensaoSolar: 0,
        alerta: "AGUARDANDO",
        conexao,
        simulado: false,
        ultimaAtualizacao: agora.toLocaleTimeString("pt-BR"),
        tokenAcesso: gerarTokenAcesso(agora)
    };
}

function gerarTokenAcesso(data = new Date()) {
    const partes = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Bahia",
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(data).reduce((acc, parte) => {
        acc[parte.type] = parte.value;
        return acc;
    }, {});

    return `TCC-${partes.day}${partes.month}${partes.year}-${partes.hour}${partes.minute}${partes.second}`;
}

function registrarCodigoConsulta(token) {
    const codigo = String(token || "").trim();
    if (!codigo) {
        return;
    }

    codigosConsultaRecentes = [codigo, ...codigosConsultaRecentes.filter((item) => item !== codigo)].slice(0, 20);
}

function obterIpLocal() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }

    return "localhost";
}

function hostEhLocal(host) {
    const nome = String(host || "").split(":")[0];
    return nome === "localhost" ||
        nome === "127.0.0.1" ||
        nome.startsWith("10.") ||
        nome.startsWith("192.168.") ||
        nome.startsWith("172.16.") ||
        nome.startsWith("172.17.") ||
        nome.startsWith("172.18.") ||
        nome.startsWith("172.19.") ||
        nome.startsWith("172.2") ||
        nome.startsWith("172.30.") ||
        nome.startsWith("172.31.");
}

function obterUrlPublica(req) {
    if (URL_PUBLICA) {
        return URL_PUBLICA;
    }

    const host = req.headers["x-forwarded-host"] || req.headers.host;
    if (!host || hostEhLocal(host)) {
        return "";
    }

    const protocolo = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
    return `${protocolo}://${host}`;
}

function criarRegistroLeitura(dados) {
    return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        dataISO: new Date().toISOString(),
        horario: dados.ultimaAtualizacao,
        nivel: dados.nivel,
        bomba: dados.bomba,
        corrente: dados.corrente,
        tensaoBateria: dados.tensaoBateria,
        cargaBateria: dados.cargaBateria,
        tensaoSolar: dados.tensaoSolar,
        alerta: dados.alerta,
        conexao: dados.conexao,
        simulado: Boolean(dados.simulado),
        tokenAcesso: dados.tokenAcesso || ""
    };
}

function inicializarBanco() {
    if (!BANCO_ATIVO) {
        return;
    }

    fs.mkdirSync(path.dirname(BANCO_ARQUIVO), { recursive: true });

    if (!fs.existsSync(BANCO_ARQUIVO)) {
        fs.writeFileSync(BANCO_ARQUIVO, "", "utf8");
    }

    historico = lerLeiturasSalvas(LIMITE_HISTORICO);
}

function lerLeiturasSalvas(limite = LIMITE_HISTORICO) {
    if (!BANCO_ATIVO || !fs.existsSync(BANCO_ARQUIVO)) {
        return [];
    }

    const linhas = fs.readFileSync(BANCO_ARQUIVO, "utf8").trim().split(/\r?\n/).filter(Boolean);
    return linhas.slice(-limite).map((linha) => {
        try {
            return JSON.parse(linha);
        } catch (erro) {
            return null;
        }
    }).filter(Boolean);
}

async function lerLeiturasBanco(limite = LIMITE_HISTORICO) {
    return lerLeiturasSalvas(limite);
}

function obterInicioPeriodo(periodo, inicio) {
    if (inicio) {
        const data = new Date(inicio);
        return Number.isNaN(data.getTime()) ? null : data;
    }

    const agora = new Date();
    if (periodo === "hoje") {
        return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    }
    if (periodo === "24h") {
        return new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    if (periodo === "7d") {
        return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }
    return null;
}

function filtrarLeituras(leituras, query) {
    const inicio = obterInicioPeriodo(query.periodo, query.inicio);
    const fim = query.fim ? new Date(query.fim) : null;

    return leituras.filter((leitura) => {
        const data = new Date(leitura.dataISO || leitura.created_at || 0);
        if (Number.isNaN(data.getTime())) {
            return true;
        }
        if (inicio && data < inicio) {
            return false;
        }
        if (fim && !Number.isNaN(fim.getTime()) && data > fim) {
            return false;
        }
        return true;
    });
}

function calcularRelatorio(leituras) {
    const total = leituras.length;
    const soma = (campo) => leituras.reduce((acc, item) => acc + (Number(item[campo]) || 0), 0);
    const max = (campo) => total ? Math.max(...leituras.map((item) => Number(item[campo]) || 0)) : 0;
    const min = (campo) => total ? Math.min(...leituras.map((item) => Number(item[campo]) || 0)) : 0;
    const alertas = selecionarAlertas(leituras).length;
    const bombaLigada = leituras.filter((item) => item.bomba === "LIGADA").length;
    const ultima = leituras[leituras.length - 1] || null;

    return {
        total,
        mediaBateria: total ? Number((soma("cargaBateria") / total).toFixed(1)) : 0,
        mediaSolar: total ? Number((soma("tensaoSolar") / total).toFixed(1)) : 0,
        maiorCorrente: Number(max("corrente").toFixed(2)),
        menorBateria: Number(min("cargaBateria").toFixed(1)),
        menorSolar: Number(min("tensaoSolar").toFixed(1)),
        alertas,
        bombaLigada,
        ultima
    };
}

function selecionarAlertas(leituras) {
    return leituras.filter((leitura) => {
        return leitura.alerta && leitura.alerta !== "NORMAL" ||
            leitura.nivel === "CHEIO" ||
            leitura.bomba === "LIGADA" ||
            Number(leitura.cargaBateria) < 25 ||
            Number(leitura.corrente) > 4 ||
            Number(leitura.tensaoSolar) < 10;
    });
}

function valorCSV(valor) {
    const texto = String(valor == null ? "" : valor);
    return `"${texto.replaceAll('"', '""')}"`;
}

function gerarCSV(leituras) {
    const colunas = [
        "Data e hora",
        "Horario local",
        "Nivel da agua",
        "Status da bomba",
        "Corrente (A)",
        "Tensao bateria (V)",
        "Carga bateria (%)",
        "Tensao solar (V)",
        "Alerta",
        "Conexao",
        "Origem"
    ];

    const linhas = leituras.map((leitura) => {
        const data = leitura.dataISO ? new Date(leitura.dataISO) : null;
        const dataFormatada = data && !Number.isNaN(data.getTime()) ? data.toLocaleString("pt-BR") : "";

        return [
            dataFormatada,
            leitura.horario,
            leitura.nivel,
            leitura.bomba,
            Number(leitura.corrente || 0).toFixed(2),
            Number(leitura.tensaoBateria || 0).toFixed(1),
            Math.round(Number(leitura.cargaBateria || 0)),
            Number(leitura.tensaoSolar || 0).toFixed(1),
            leitura.alerta,
            leitura.conexao,
            leitura.simulado ? "Simulada" : "Arduino"
        ].map(valorCSV).join(";");
    });

    return `\uFEFF${[colunas.map(valorCSV).join(";"), ...linhas].join("\n")}`;
}

function contarLeiturasSalvas() {
    if (!BANCO_ATIVO || !fs.existsSync(BANCO_ARQUIVO)) {
        return 0;
    }

    const conteudo = fs.readFileSync(BANCO_ARQUIVO, "utf8").trim();
    return conteudo ? conteudo.split(/\r?\n/).length : 0;
}

async function salvarLeituraLocal(registro) {
    if (!BANCO_ATIVO) {
        return false;
    }

    try {
        fs.mkdirSync(path.dirname(BANCO_ARQUIVO), { recursive: true });
        await fs.promises.appendFile(BANCO_ARQUIVO, `${JSON.stringify(registro)}\n`, "utf8");
        return true;
    } catch (erro) {
        console.error("Erro ao salvar localmente:", erro.message);
        return false;
    }
}

function salvarLeituraBanco(registro) {
    if (!BANCO_ATIVO || (!SALVAR_SIMULADOS && registro.simulado)) {
        return;
    }

    const agora = Date.now();
    if (registro.simulado && agora - ultimaGravacaoBanco < INTERVALO_GRAVACAO_MS) {
        return;
    }

    ultimaGravacaoBanco = agora;
    filaBanco = filaBanco
        .then(async() => {
            await salvarLeituraLocal(registro);
        })
        .catch((erro) => {
            console.error("Erro ao salvar leitura no banco:", erro.message);
            return salvarLeituraLocal(registro);
        });
}

function limitarNumero(valor, minimo, maximo, padrao = 0) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) {
        return padrao;
    }
    return Math.min(maximo, Math.max(minimo, numero));
}

function normalizarTexto(valor, permitidos, padrao) {
    const texto = String(valor || "").trim().toUpperCase();
    return permitidos.includes(texto) ? texto : padrao;
}

function definirAlertaLeitura({ alerta, nivel, tensaoBateria, corrente }) {
    const alertaRecebido = String(alerta || "").trim().toUpperCase();
    if (alertaRecebido && alertaRecebido !== "NORMAL") {
        return alertaRecebido.substring(0, 80);
    }

    if (nivel === "CHEIO") {
        return "TANQUE CHEIO";
    }

    if (Number(tensaoBateria) > 0 && Number(tensaoBateria) < 11.5) {
        return "BATERIA BAIXA";
    }

    if (Number(corrente) > 4) {
        return "CORRENTE ALTA";
    }

    return "NORMAL";
}

function validarDadosArduino(dados) {
    if (!dados || typeof dados !== "object") {
        return null;
    }

    const tensaoBateria = limitarNumero(dados.tensaoBateria, 0, 30);
    const cargaBateria = limitarNumero(dados.cargaBateria, 0, 100);
    const corrente = limitarNumero(dados.corrente, 0, 30);
    const tensaoSolar = limitarNumero(dados.tensaoSolar, 0, 40);
    const nivel = normalizarTexto(dados.nivel, ["BAIXO", "MEDIO", "CHEIO", "INDEFINIDO"], "INDEFINIDO");

    const agora = new Date();

    return {
        nivel,
        bomba: normalizarTexto(dados.bomba, ["LIGADA", "DESLIGADA", "PAUSADA", "INDEFINIDO"], "INDEFINIDO"),
        corrente,
        tensaoBateria,
        cargaBateria,
        tensaoSolar,
        alerta: definirAlertaLeitura({ alerta: dados.alerta, nivel, tensaoBateria, corrente }),
        conexao: "online",
        simulado: false,
        ultimaAtualizacao: agora.toLocaleTimeString("pt-BR"),
        tokenAcesso: gerarTokenAcesso(agora)
    };
}

function adicionarHistorico(dados) {
    const registro = criarRegistroLeitura(dados);
    historico.push(registro);

    if (historico.length > LIMITE_HISTORICO) {
        historico = historico.slice(-LIMITE_HISTORICO);
    }

    salvarLeituraBanco(registro);
}

function gerarDadosSimulados() {
    const agora = new Date();
    const segundos = Date.now() / 1000;
    const cicloEnergia = Math.sin(segundos / 9);
    const faseReservatorio = segundos % 36;
    const bateria = limitarNumero(76 + cicloEnergia * 18, 8, 100);
    const tensaoBateria = 10.8 + bateria * 0.055;
    const tensaoSolar = limitarNumero(15 + Math.sin(segundos / 6) * 4, 0, 22);
    const corrente = limitarNumero(1.8 + Math.abs(Math.sin(segundos / 4)) * 2.4, 0, 8);

    let nivel = "MEDIO";
    let bomba = "LIGADA";

    if (faseReservatorio < 10) {
        nivel = "BAIXO";
        bomba = "LIGADA";
    } else if (faseReservatorio < 24) {
        nivel = "MEDIO";
        bomba = "LIGADA";
    } else {
        nivel = "CHEIO";
        bomba = "DESLIGADA";
    }

    if (bateria < 20) {
        bomba = "PAUSADA";
    }

    const alerta = definirAlertaLeitura({ nivel, tensaoBateria, corrente });

    return {
        nivel,
        bomba,
        corrente: Number(corrente.toFixed(2)),
        tensaoBateria: Number(tensaoBateria.toFixed(1)),
        cargaBateria: Math.round(bateria),
        tensaoSolar: Number(tensaoSolar.toFixed(1)),
        alerta,
        conexao: MODO_CLOUD ? "cloud" : "simulado",
        simulado: true,
        ultimaAtualizacao: agora.toLocaleTimeString("pt-BR"),
        tokenAcesso: gerarTokenAcesso(agora)
    };
}

function obterDadosAtuais() {
    const semLeituraReal = Date.now() - ultimaLeituraReal > 5000;
    const deveSimular = modoOperacao === "simulacao" ||
        (modoOperacao === "automatico" && SIMULACAO_AUTOMATICA && (MODO_CLOUD || dadosArduino.conexao !== "online" || semLeituraReal));

    if (modoOperacao === "arduino" && (dadosArduino.simulado || dadosArduino.conexao !== "online" || semLeituraReal)) {
        const aguardando = {
            ...criarDadosBase(MODO_CLOUD ? "cloud" : portaSerial?.isOpen ? "online" : "offline"),
            modoOperacao
        };
        registrarCodigoConsulta(aguardando.tokenAcesso);
        return aguardando;
    }

    if (deveSimular) {
        const simulado = gerarDadosSimulados();
        simulado.modoOperacao = modoOperacao;
        dadosArduino = simulado;
        registrarCodigoConsulta(simulado.tokenAcesso);
        adicionarHistorico(simulado);
        return simulado;
    }

    registrarCodigoConsulta(dadosArduino.tokenAcesso);
    return {
        ...dadosArduino,
        modoOperacao
    };
}

async function conectarArduino() {
    if (MODO_CLOUD) {
        console.log("Modo cloud ativo: servidor online sem conexao serial com Arduino.");
        dadosArduino.conexao = "cloud";
        return;
    }

    try {
        const { SerialPort } = require("serialport");
        const { ReadlineParser } = require("@serialport/parser-readline");
        const portasDisponiveis = await obterPortasDisponiveis();
        const portasParaTentar = listarPortasCandidatas(PORTAS_ARDUINO, portasDisponiveis);
        const portasParaLog = portasParaTentar.length ? portasParaTentar : PORTAS_ARDUINO;

        console.log(`Tentando conectar com Arduino nas portas: ${portasParaLog.join(", ") || "nenhuma"}`);

        for (const porta of portasParaLog) {
            try {
                if (portaSerial && portaSerial.isOpen) {
                    await new Promise((resolve) => portaSerial.close(() => resolve()));
                }

                portaSerial = new SerialPort({
                    path: porta,
                    baudRate: BAUD_RATE,
                    autoOpen: false
                });

                const parser = portaSerial.pipe(new ReadlineParser({ delimiter: "\n" }));

                await new Promise((resolve, reject) => {
                    portaSerial.open((erro) => {
                        if (erro) {
                            reject(erro);
                            return;
                        }

                        resolve();
                    });
                });

                console.log("Arduino conectado na porta:", porta);
                dadosArduino.conexao = "online";
                reconexaoAgendada = false;

                parser.on("data", (linha) => {
                    try {
                        if (linha.length > 1000) {
                            throw new Error("Linha muito longa");
                        }

                        const texto = linha.trim().replace(/^[^\{\[]+/, "");
                        const dadosValidados = validarDadosArduino(JSON.parse(texto));
                        if (!dadosValidados) {
                            throw new Error("Formato invalido");
                        }

                        dadosArduino = dadosValidados;
                        ultimaLeituraReal = Date.now();
                        adicionarHistorico(dadosArduino);
                    } catch (erro) {
                        console.warn("Linha JSON invalida:", linha.substring(0, 80));
                    }
                });

                portaSerial.on("error", (erro) => {
                    console.error("Erro na porta serial:", erro.message);
                    dadosArduino.conexao = "offline";
                    agendarReconexao();
                });

                portaSerial.on("close", () => {
                    console.warn("Conexao com Arduino encerrada");
                    dadosArduino.conexao = "offline";
                    agendarReconexao();
                });

                return;
            } catch (erro) {
                console.warn(`Falha ao abrir ${porta}: ${erro.message}`);
                if (portaSerial) {
                    try {
                        portaSerial.removeAllListeners();
                    } catch (remocaoErro) {
                        // ignora
                    }
                }
            }
        }

        console.error("Nao foi possivel abrir nenhuma porta serial configurada.");
        dadosArduino.conexao = "offline";
        agendarReconexao();
    } catch (erro) {
        console.error("Erro ao configurar Arduino:", erro.message);
        dadosArduino.conexao = "offline";
        agendarReconexao();
    }
}

function agendarReconexao() {
    if (reconexaoAgendada || MODO_CLOUD) {
        return;
    }

    reconexaoAgendada = true;
    console.log("Tentando reconectar em 5 segundos...");
    setTimeout(() => {
        reconexaoAgendada = false;
        conectarArduino();
    }, 5000);
}

app.get("/dados", (req, res) => {
    if (!DADOS_PUBLICOS && !diagnosticoAutorizado(req)) {
        return res.status(401).json({ erro: "Dados protegidos" });
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(obterDadosAtuais());
});

app.get("/modo", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
        modo: modoOperacao,
        opcoes: ["automatico", "simulacao", "arduino"],
        modoCloud: MODO_CLOUD,
        arduino: dadosArduino.conexao
    });
});

app.get("/token-acesso", (req, res) => {
    if (DIAGNOSTICO_TOKEN && !diagnosticoAutorizado(req)) {
        return res.status(401).json({ erro: "Codigo de consulta protegido" });
    }

    const token = obterDadosAtuais().tokenAcesso || gerarTokenAcesso();
    const base = obterUrlPublica(req) || `${req.protocol}://${req.headers.host}`;
    registrarCodigoConsulta(token);

    res.setHeader("Cache-Control", "no-store");
    res.json({
        token,
        geradoEm: dadosArduino.ultimaAtualizacao,
        mudaACadaLeitura: true,
        links: {
            leituras: `${base}/leituras.html?token=${encodeURIComponent(token)}`,
            relatorios: `${base}/relatorios.html?token=${encodeURIComponent(token)}`,
            alertas: `${base}/alertas.html?token=${encodeURIComponent(token)}`,
            diagnostico: `${base}/diagnostico.html?token=${encodeURIComponent(token)}`
        }
    });
});

app.post("/modo", (req, res) => {
    if (!alteracaoAutorizada(req)) {
        return res.status(401).json({ erro: "Alteracao de modo protegida" });
    }

    const modo = String(req.body?.modo || "").trim().toLowerCase();
    if (!["automatico", "simulacao", "arduino"].includes(modo)) {
        return res.status(400).json({ erro: "Modo invalido" });
    }

    modoOperacao = modo;

    if (modoOperacao === "arduino" && dadosArduino.simulado) {
        dadosArduino = criarDadosBase(MODO_CLOUD ? "cloud" : portaSerial?.isOpen ? "online" : "offline");
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({
        modo: modoOperacao,
        arduino: dadosArduino.conexao,
        mensagem: "Modo atualizado"
    });
});

app.get("/historico", (req, res) => {
    if (!diagnosticoAutorizado(req)) {
        return res.status(401).json({ erro: "Historico protegido" });
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(historico.slice(-LIMITE_HISTORICO));
});

app.get("/leituras", async(req, res) => {
    if (!diagnosticoAutorizado(req)) {
        return res.status(401).json({ erro: "Leituras protegidas" });
    }

    const limite = limitarNumero(req.query.limite, 1, 1000, LIMITE_HISTORICO);
    res.setHeader("Cache-Control", "no-store");

    try {
        const leituras = await lerLeiturasBanco(limite);
        res.json(filtrarLeituras(leituras, req.query));
    } catch (erro) {
        console.error("Erro ao consultar leituras:", erro.message);
        res.status(500).json({ erro: "Nao foi possivel consultar as leituras." });
    }
});

app.get("/relatorio", async(req, res) => {
    if (!diagnosticoAutorizado(req)) {
        return res.status(401).json({ erro: "Relatorio protegido" });
    }

    try {
        const leituras = filtrarLeituras(await lerLeiturasBanco(1000), req.query);
        res.setHeader("Cache-Control", "no-store");
        res.json(calcularRelatorio(leituras));
    } catch (erro) {
        console.error("Erro ao gerar relatorio:", erro.message);
        res.status(500).json({ erro: "Nao foi possivel gerar o relatorio." });
    }
});

app.get("/alertas", async(req, res) => {
    if (!diagnosticoAutorizado(req)) {
        return res.status(401).json({ erro: "Alertas protegidos" });
    }

    try {
        const leituras = filtrarLeituras(await lerLeiturasBanco(1000), req.query);
        res.setHeader("Cache-Control", "no-store");
        res.json(selecionarAlertas(leituras).slice(-200));
    } catch (erro) {
        console.error("Erro ao consultar alertas:", erro.message);
        res.status(500).json({ erro: "Nao foi possivel consultar alertas." });
    }
});

app.get("/exportar.csv", async(req, res) => {
    if (!diagnosticoAutorizado(req)) {
        return res.status(401).type("text/plain").send("Exportacao protegida");
    }

    try {
        const leituras = filtrarLeituras(await lerLeiturasBanco(1000), req.query);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        const dataArquivo = new Date().toISOString().slice(0, 10);
        res.setHeader("Content-Disposition", `attachment; filename="leituras-${dataArquivo}.csv"`);
        res.send(gerarCSV(leituras));
    } catch (erro) {
        console.error("Erro ao exportar CSV:", erro.message);
        res.status(500).type("text/plain").send("Nao foi possivel exportar CSV.");
    }
});

app.get("/saude", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
        status: "online",
        arduino: DIAGNOSTICO_TOKEN && !diagnosticoAutorizado(req) ? "protegido" : dadosArduino.conexao,
        modoOperacao,
        modoCloud: MODO_CLOUD,
        simulacaoAutomatica: SIMULACAO_AUTOMATICA,
        bancoAtivo: BANCO_ATIVO,
        bancoTipo: BANCO_ATIVO ? "local" : "desativado",
        salvarSimulados: SALVAR_SIMULADOS,
        tempo: new Date().toLocaleTimeString("pt-BR")
    });
});

app.get("/rede", (req, res) => {
    if (!alteracaoAutorizada(req)) {
        return res.status(401).json({ erro: "Informacoes de rede protegidas" });
    }

    const ipLocal = obterIpLocal();
    const baseLocal = `http://localhost:${PORTA_SITE}`;
    const baseRede = `http://${ipLocal}:${PORTA_SITE}`;
    const urlPublica = obterUrlPublica(req);

    res.setHeader("Cache-Control", "no-store");
    res.json({
        ipLocal,
        porta: PORTA_SITE,
        mesmoDispositivo: baseLocal,
        celular: baseRede,
        leiturasCelular: `${baseRede}/leituras.html`,
        painelCelular: `${baseRede}/painel.html`,
        urlPublica,
        leiturasPublicas: urlPublica ? `${urlPublica}/leituras.html` : "",
        painelPublico: urlPublica ? `${urlPublica}/painel.html` : ""
    });
});

function diagnosticoAutorizado(req) {
    const tokenInformado = String(req.headers["x-diagnostico-token"] || req.query.token || "").trim();
    const tokenAtual = String(dadosArduino.tokenAcesso || "").trim();
    const tokenRecente = historico.some((leitura) => String(leitura.tokenAcesso || "").trim() === tokenInformado);
    const codigoRecente = codigosConsultaRecentes.includes(tokenInformado);

    if (DIAGNOSTICO_TOKEN) {
        return tokenInformado === DIAGNOSTICO_TOKEN;
    }

    if (tokenInformado && ((tokenAtual && tokenInformado === tokenAtual) || tokenRecente || codigoRecente)) {
        return true;
    }

    return false;
}

function alteracaoAutorizada(req) {
    const tokenInformado = String(req.headers["x-diagnostico-token"] || req.query.token || "").trim();

    if (DIAGNOSTICO_TOKEN) {
        return tokenInformado === DIAGNOSTICO_TOKEN;
    }

    return diagnosticoAutorizado(req);
}

app.get("/diagnostico", async(req, res) => {
    if (!diagnosticoAutorizado(req)) {
        return res.status(401).json({ erro: "Diagnostico protegido" });
    }

    let leiturasSalvas = 0;
    try {
        leiturasSalvas = contarLeiturasSalvas();
    } catch (erro) {
        console.error("Erro ao contar leituras:", erro.message);
        leiturasSalvas = contarLeiturasSalvas();
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({
        statusServidor: "online",
        modoCloud: MODO_CLOUD,
        modoOperacao,
        simulacaoAutomatica: SIMULACAO_AUTOMATICA,
        portaArduino: MODO_CLOUD ? "desativada no modo cloud" : PORTAS_ARDUINO.join(", "),
        baudRate: BAUD_RATE,
        conexaoArduino: dadosArduino.conexao,
        ultimaAtualizacao: dadosArduino.ultimaAtualizacao,
        leiturasNoHistorico: historico.length,
        banco: {
            ativo: BANCO_ATIVO,
            tipo: BANCO_ATIVO ? "local" : "desativado",
            arquivo: BANCO_ATIVO ? BANCO_ARQUIVO : "desativado",
            salvarSimulados: SALVAR_SIMULADOS,
            intervaloGravacaoMs: INTERVALO_GRAVACAO_MS,
            leiturasSalvas
        },
        memoria: {
            rssMB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
            heapUsadoMB: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1))
        },
        uptimeSegundos: Math.round(process.uptime())
    });
});

app.use((req, res) => {
    res.status(404).json({ erro: "Rota nao encontrada" });
});

if (require.main === module) {
    app.listen(PORTA_SITE, "0.0.0.0", () => {
        const ipLocal = obterIpLocal();

        inicializarBanco();
        console.log(`\nServidor rodando em http://${ipLocal}:${PORTA_SITE}`);
        console.log(`Acesse de outro dispositivo: http://${ipLocal}:${PORTA_SITE}`);
        console.log(`Leituras no celular: http://${ipLocal}:${PORTA_SITE}/leituras.html`);
        console.log(`Diagnostico: http://${ipLocal}:${PORTA_SITE}/diagnostico`);
        conectarArduino();
    });

    process.on("SIGINT", () => {
        console.log("\nEncerrando servidor...");
        if (portaSerial) {
            portaSerial.close();
        }
        process.exit(0);
    });
}

module.exports = {
    parsePortasArduino,
    listarPortasCandidatas,
    obterPortasDisponiveis
};
