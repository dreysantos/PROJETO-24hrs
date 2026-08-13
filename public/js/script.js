let ultimoErro = null;
let tentativasConexao = 0;
let historicoLocal = [];
let tokenAcessoCache = null;

const ids = {
    pontoConexao: "pontoConexao",
    textoConexao: "textoConexao",
    nivelAgua: "nivelAgua",
    statusBomba: "statusBomba",
    corrente: "corrente",
    solar: "solar",
    alerta: "alerta",
    barraNivel: "barraNivel",
    barraSolar: "barraSolar",
    barraCorrente: "barraCorrente",
    lcdLinha1: "lcdLinha1",
    lcdLinha2: "lcdLinha2",
    lcdLinha3: "lcdLinha3",
    lcdLinha4: "lcdLinha4",
    graficoHistorico: "graficoHistorico"
};

function elemento(id) {
    return document.getElementById(id);
}

function escaparHTML(valor) {
    return String(valor ? valor : "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function texto(id, valor) {
    const el = elemento(id);
    if (el) {
        el.innerText = valor;
    }
}

function configurarBotaoTopo() {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "botao-topo";
    botao.setAttribute("aria-label", "Voltar ao topo");
    botao.innerText = "↑";
    document.body.appendChild(botao);

    function atualizarVisibilidade() {
        botao.classList.toggle("visivel", window.scrollY > 360);
    }

    botao.addEventListener("click", () => {
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });

    window.addEventListener("scroll", atualizarVisibilidade, { passive: true });
    atualizarVisibilidade();
}

function atualizarStatusConexao(online = false, conexaoArduino = "offline", simulado = false) {
    const ponto = elemento(ids.pontoConexao);
    const label = elemento(ids.textoConexao);

    if (!ponto || !label) {
        return;
    }

    if (online && conexaoArduino === "online" && !simulado) {
        ponto.className = "ponto-conexao online";
        label.innerText = `Online - Arduino atualizado às ${new Date().toLocaleTimeString("pt-BR")}`;
        tentativasConexao = 0;
        return;
    }

    if (online && simulado) {
        ponto.className = "ponto-conexao simulado";
        label.innerText = "Modo simulação - dados demonstrativos ativos";
        tentativasConexao = 0;
        return;
    }

    if (online && !simulado && (conexaoArduino === "offline" || conexaoArduino === "cloud")) {
        ponto.className = "ponto-conexao offline";
        label.innerText = "Arduino ativo - aguardando sinal do protótipo";
        tentativasConexao = 0;
        return;
    }

    if (online) {
        ponto.className = "ponto-conexao offline";
        label.innerText = "Site online - aguardando sinal do Arduino";
        tentativasConexao = 0;
        return;
    }

    ponto.className = "ponto-conexao offline";
    label.innerText = "Offline - reconectando...";
}

function limparClasses() {
    [ids.nivelAgua, ids.statusBomba, ids.alerta, ids.corrente, ids.solar].forEach((id) => {
        const el = elemento(id);
        if (el) {
            el.className = "valor";
        }
    });
}

function definirClasseStatus(id, classe) {
    const el = elemento(id);
    if (el) {
        el.classList.add(classe);
    }
}

function percentualNivel(nivel) {
    if (nivel === "CHEIO") return 100;
    if (nivel === "MEDIO") return 55;
    if (nivel === "BAIXO") return 22;
    return 8;
}

function atualizarBarra(id, percentual, classe = "normal") {
    const barra = elemento(id);
    if (!barra) {
        return;
    }

    const preenchimento = barra.querySelector("span");
    barra.className = `barra-medidor ${classe}`;
    if (preenchimento) {
        preenchimento.style.width = `${Math.max(0, Math.min(100, percentual))}%`;
    }
}

function atualizarLCD(linha1, linha2, linha3, linha4) {
    texto(ids.lcdLinha1, linha1);
    texto(ids.lcdLinha2, linha2);
    texto(ids.lcdLinha3, linha3);
    texto(ids.lcdLinha4, linha4);
}

function desenharGrafico() {
    const canvas = elemento(ids.graficoHistorico);
    if (!canvas || historicoLocal.length < 2) {
        return;
    }

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    canvas.width = largura * dpr;
    canvas.height = altura * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, largura, altura);

    const paddingEsquerda = 52;
    const paddingDireita = 58;
    const paddingTopo = 28;
    const paddingBaixo = 34;
    const pontos = historicoLocal.slice(-30);
    const maxX = Math.max(1, pontos.length - 1);
    const area = {
        esquerda: paddingEsquerda,
        direita: largura - paddingDireita,
        topo: paddingTopo,
        baixo: altura - paddingBaixo
    };

    ctx.font = "12px Arial";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#d5e4e5";
    ctx.fillStyle = "#5d706e";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = area.topo + ((area.baixo - area.topo) / 4) * i;
        const solar = 25 - i * 6.25;

        ctx.beginPath();
        ctx.moveTo(area.esquerda, y);
        ctx.lineTo(area.direita, y);
        ctx.stroke();

        ctx.textAlign = "left";
        ctx.fillText(`${solar.toFixed(solar % 1 === 0 ? 0 : 1)}V`, area.direita + 8, y);
    }

    const corSolar = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f6a01a";

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "right";
    ctx.fillStyle = corSolar;
    ctx.fillText("Solar (V)", area.direita, 16);

    desenharLinha(ctx, pontos, "tensaoSolar", corSolar, area, maxX, 25, "V");
}

function desenharLinha(ctx, pontos, campo, cor, area, maxX, maxY, unidade) {
    ctx.strokeStyle = cor;
    ctx.lineWidth = 3;
    ctx.beginPath();

    pontos.forEach((ponto, index) => {
        const valor = Math.min(maxY, Number(ponto[campo]) || 0);
        const x = area.esquerda + ((area.direita - area.esquerda) / maxX) * index;
        const y = area.baixo - (valor / maxY) * (area.baixo - area.topo);

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    const ultimo = pontos[pontos.length - 1];
    const valorFinal = Math.min(maxY, Number(ultimo[campo]) || 0);
    const xFinal = area.direita;
    const yFinal = area.baixo - (valorFinal / maxY) * (area.baixo - area.topo);
    const casas = unidade === "%" ? 0 : 1;

    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.arc(xFinal, yFinal, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${valorFinal.toFixed(casas)}${unidade}`, xFinal + 8, yFinal);
}

function atualizarPainel(dados) {
    atualizarStatusConexao(true, dados.conexao, dados.simulado);
    ultimoErro = null;

    if (dados.tokenAcesso) {
        tokenAcessoCache = {
            token: dados.tokenAcesso,
            geradoEm: dados.ultimaAtualizacao,
            mudaACadaLeitura: true,
            links: {
                leituras: `${window.location.origin}/leituras.html?token=${encodeURIComponent(dados.tokenAcesso)}`,
                relatorios: `${window.location.origin}/relatorios.html?token=${encodeURIComponent(dados.tokenAcesso)}`,
                alertas: `${window.location.origin}/alertas.html?token=${encodeURIComponent(dados.tokenAcesso)}`,
                diagnostico: `${window.location.origin}/diagnostico.html?token=${encodeURIComponent(dados.tokenAcesso)}`
            }
        };
        camposToken().forEach((campo) => {
            campo.value = dados.tokenAcesso;
        });
        renderizarTokenAcesso(tokenAcessoCache);
    }

    const nivel = dados.nivel || "INDEFINIDO";
    const bomba = dados.bomba || "INDEFINIDO";
    const corrente = Number(dados.corrente) || 0;
    const tensaoSolar = Number(dados.tensaoSolar) || 0;
    const alerta = dados.alerta || "INDEFINIDO";

    texto(ids.nivelAgua, nivel);
    texto(ids.statusBomba, bomba);
    texto(ids.corrente, `${corrente.toFixed(2)} A`);
    texto(ids.solar, `${tensaoSolar.toFixed(1)} V`);
    texto(ids.alerta, alerta);

    limparClasses();

    definirClasseStatus(ids.alerta, alerta === "NORMAL" ? "status-normal" : "status-alerta");
    definirClasseStatus(ids.nivelAgua, nivel === "CHEIO" ? "status-alerta" : nivel === "MEDIO" ? "status-atencao" : "status-alerta");
    definirClasseStatus(ids.statusBomba, bomba === "LIGADA" ? "status-atencao" : "status-normal");
    definirClasseStatus(ids.corrente, corrente > 4 ? "status-alerta" : "status-normal");
    definirClasseStatus(ids.solar, tensaoSolar < 10 ? "status-atencao" : "status-normal");

    atualizarBarra(ids.barraNivel, percentualNivel(nivel), nivel === "CHEIO" || nivel === "BAIXO" ? "alerta" : nivel === "MEDIO" ? "atencao" : "normal");
    atualizarBarra(ids.barraSolar, (tensaoSolar / 22) * 100, tensaoSolar < 10 ? "atencao" : "normal");
    atualizarBarra(ids.barraCorrente, (corrente / 8) * 100, corrente > 4 ? "alerta" : "normal");

    atualizarLCD(
        "TANQUE DE AGUA",
        `NIVEL: ${nivel}`,
        `SOLAR:${tensaoSolar.toFixed(1)}V`,
        `${corrente.toFixed(2)}A`
    );

    historicoLocal.push({
        tensaoSolar,
        corrente,
        horario: dados.ultimaAtualizacao
    });

    if (historicoLocal.length > 60) {
        historicoLocal = historicoLocal.slice(-60);
    }

    desenharGrafico();
}

async function buscarJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const resposta = await fetch(url, {
            method: "GET",
            signal: controller.signal
        });

        if (!resposta.ok) {
            throw new Error(`HTTP ${resposta.status}`);
        }

        return await resposta.json();
    } finally {
        clearTimeout(timeout);
    }
}

function formatarDataLeitura(leitura) {
    if (!leitura.dataISO) {
        return leitura.horario || "-";
    }

    const data = new Date(leitura.dataISO);
    if (Number.isNaN(data.getTime())) {
        return leitura.horario || "-";
    }

    return data.toLocaleString("pt-BR");
}

function classeAlerta(alerta) {
    if (alerta === "NORMAL") {
        return "ok";
    }

    return alerta ? "erro" : "aviso";
}

function tokenAtualLocal(idCampo) {
    return elemento(idCampo)?.value || new URLSearchParams(window.location.search).get("token") || "";
}

function camposToken() {
    return ["tokenModo", "tokenLeituras", "tokenRelatorio", "tokenAlertas"].map(elemento).filter(Boolean);
}

function renderizarTokenAcesso(dados) {
    const consultas = document.querySelectorAll(".consulta-box, .modo-box");
    if (!consultas.length || !dados?.token) {
        return;
    }

    consultas.forEach((consulta) => {
        let box = consulta.querySelector(".token-acesso-box");
        if (!box) {
            box = document.createElement("div");
            box.className = "token-acesso-box";
            consulta.appendChild(box);
        }

        const paginaAtual = window.location.pathname.replace(/^\//, "").replace(/\.html$/, "");
        const linkAtual = dados.links?.[paginaAtual] || `${window.location.origin}${window.location.pathname}?token=${encodeURIComponent(dados.token)}`;
        box.innerHTML = `
            <strong>Código da leitura</strong>
            <code>${escaparHTML(dados.token)}</code>
            <button class="botao-primario botao-consulta botao-secundario copiar-token" type="button" data-token="${escaparHTML(dados.token)}">Copiar código</button>
            <a class="botao-primario botao-consulta botao-secundario" href="${escaparHTML(linkAtual)}">Abrir com código</a>
            <p>Código gerado pelo horário da leitura. Ele muda quando chega uma nova leitura.</p>
        `;
    });

    document.querySelectorAll(".copiar-token").forEach((botao) => {
        botao.addEventListener("click", async() => {
            try {
                await navigator.clipboard.writeText(botao.dataset.token || dados.token);
                botao.innerText = "Copiado";
                setTimeout(() => {
                    botao.innerText = "Copiar código";
                }, 1800);
            } catch (erro) {
                botao.innerText = "Copie manualmente";
            }
        });
    });
}

async function carregarTokenAcesso(forcar = false) {
    const tokenUrl = new URLSearchParams(window.location.search).get("token");
    if (!forcar && tokenAcessoCache?.token) {
        return tokenAcessoCache;
    }

    try {
        const dados = await buscarJSON("/token-acesso");
        tokenAcessoCache = dados;
        camposToken().forEach((campo) => {
            if (!campo.value || campo.value === tokenUrl) {
                campo.value = dados.token;
            }
        });
        renderizarTokenAcesso(dados);
        return dados;
    } catch (erro) {
        return tokenUrl ? { token: tokenUrl } : { token: "" };
    }
}

async function tokenAtual(idCampo) {
    const preenchido = tokenAtualLocal(idCampo);
    if (preenchido) {
        return preenchido;
    }

    const dados = await carregarTokenAcesso();
    return dados.token || "";
}

function montarQuery(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([chave, valor]) => {
        if (valor) {
            query.set(chave, valor);
        }
    });
    return query.toString();
}

function nomeModo(modo) {
    const nomes = {
        automatico: "Automático",
        simulacao: "Simulação",
        arduino: "Arduino ativo"
    };
    return nomes[modo] || modo || "-";
}

async function enviarJSON(url, dados) {
    const resposta = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(dados)
    });

    if (!resposta.ok) {
        throw new Error(`HTTP ${resposta.status}`);
    }

    return resposta.json();
}

async function carregarModoOperacao() {
    const seletor = elemento("modoOperacao");
    const status = elemento("statusModo");
    if (!seletor || !status) {
        return;
    }

    try {
        const dados = await buscarJSON("/modo");
        seletor.value = dados.modo;
        status.innerText = `Modo atual: ${nomeModo(dados.modo)} | Arduino: ${dados.arduino}`;
    } catch (erro) {
        status.innerText = `Não foi possível carregar o modo: ${erro.message}`;
    }
}

async function aplicarModoOperacao() {
    const seletor = elemento("modoOperacao");
    const status = elemento("statusModo");
    if (!seletor || !status) {
        return;
    }

    const token = await tokenAtual("tokenModo");
    status.innerText = "Aplicando modo...";

    try {
        const resposta = await enviarJSON(`/modo?${montarQuery({ token })}`, {
            modo: seletor.value
        });
        status.innerText = `Modo atual: ${nomeModo(resposta.modo)}`;
        buscarDadosArduino();
    } catch (erro) {
        status.innerText = `Não foi possível alterar. Use o código da leitura exibido na tela. (${erro.message})`;
    }
}

function atualizarStatusLeituras(tipo, mensagem) {
    const status = elemento("statusLeituras");
    if (!status) {
        return;
    }

    const classePonto = tipo === "ok" ? "online" : tipo === "erro" ? "offline" : "simulado";
    status.innerHTML = `<span class="ponto-conexao ${classePonto}"></span><span>${escaparHTML(mensagem)}</span>`;
}

function atualizarResumoLeituras(leituras) {
    const resumo = elemento("resumoLeituras");
    if (!resumo) {
        return;
    }

    const ultima = leituras[leituras.length - 1];
    const reais = leituras.filter((leitura) => !leitura.simulado).length;
    const simuladas = leituras.length - reais;

    resumo.innerHTML = `
        <div class="diagnostico-item">
            <strong>Total carregado</strong>
            <p>${leituras.length} leituras</p>
        </div>
        <div class="diagnostico-item">
            <strong>Último registro</strong>
            <p>${ultima ? escaparHTML(formatarDataLeitura(ultima)) : "Sem dados salvos"}</p>
        </div>
        <div class="diagnostico-item">
            <strong>Origem dos dados</strong>
            <p>${reais} reais / ${simuladas} simuladas</p>
        </div>
    `;
}

function renderizarTabelaLeituras(leituras) {
    const tabela = elemento("tabelaLeituras");
    if (!tabela) {
        return;
    }

    if (leituras.length === 0) {
        tabela.innerHTML = `<tr><td colspan="8">Nenhuma leitura salva ainda. Abra o painel, aguarde alguns segundos e atualize esta página.</td></tr>`;
        renderizarCardsLeituras([]);
        return;
    }

    tabela.innerHTML = leituras.slice().reverse().map((leitura) => {
                const alerta = leitura.alerta || "-";
                const origem = leitura.simulado ? "Simulada" : "Arduino";
                const token = leitura.tokenAcesso || "";

                return `
            <tr>
                <td>${escaparHTML(formatarDataLeitura(leitura))}</td>
                <td><span class="selo ${leitura.nivel === "CHEIO" || leitura.nivel === "BAIXO" ? "erro" : "aviso"}">${escaparHTML(leitura.nivel || "-")}</span></td>
                <td>${escaparHTML(leitura.bomba || "-")}</td>
                <td>${Number(leitura.tensaoBateria || 0).toFixed(1)}V / ${Math.round(Number(leitura.cargaBateria || 0))}%</td>
                <td>${Number(leitura.tensaoSolar || 0).toFixed(1)}V</td>
                <td>${Number(leitura.corrente || 0).toFixed(2)}A</td>
                <td><span class="selo ${classeAlerta(alerta)}">${escaparHTML(alerta)}</span></td>
                <td><span class="selo ${leitura.simulado ? "aviso" : "ok"}">${origem}</span>${token ? `<br><code>${escaparHTML(token)}</code>` : ""}</td>
            </tr>
        `;
    }).join("");

    renderizarCardsLeituras(leituras);
}

function renderizarCardsLeituras(leituras) {
    const cards = elemento("cardsLeituras");
    if (!cards) {
        return;
    }

    if (leituras.length === 0) {
        cards.innerHTML = "";
        return;
    }

    cards.innerHTML = leituras.slice().reverse().map((leitura) => `
        <div class="diagnostico-item leitura-card">
            <strong>${escaparHTML(formatarDataLeitura(leitura))}</strong>
            <p>Nível: ${escaparHTML(leitura.nivel || "-")} | Bomba: ${escaparHTML(leitura.bomba || "-")}</p>
            <p>Bateria: ${Number(leitura.tensaoBateria || 0).toFixed(1)}V / ${Math.round(Number(leitura.cargaBateria || 0))}%</p>
            <p>Solar: ${Number(leitura.tensaoSolar || 0).toFixed(1)}V | Corrente: ${Number(leitura.corrente || 0).toFixed(2)}A</p>
            <p>Alerta: ${escaparHTML(leitura.alerta || "-")}</p>
            ${leitura.tokenAcesso ? `<p>Código da leitura: <code>${escaparHTML(leitura.tokenAcesso)}</code></p>` : ""}
        </div>
    `).join("");
}

async function carregarLeituras() {
    const tabela = elemento("tabelaLeituras");
    if (!tabela) {
        return;
    }

    const limite = elemento("limiteLeituras")?.value || "50";
    const periodo = elemento("periodoLeituras")?.value || "";
    const tokenCampo = elemento("tokenLeituras");
    const tokenUrl = new URLSearchParams(window.location.search).get("token");
    const token = await tokenAtual("tokenLeituras");
    const url = `/leituras?${montarQuery({ limite, periodo, token })}`;

    if (tokenCampo && tokenUrl && !tokenCampo.value) {
        tokenCampo.value = tokenUrl;
    }

    atualizarStatusLeituras("carregando", "Consultando o banco local...");

    try {
        const leituras = await buscarJSON(url);
        renderizarTabelaLeituras(Array.isArray(leituras) ? leituras : []);
        atualizarResumoLeituras(Array.isArray(leituras) ? leituras : []);
        atualizarStatusLeituras("ok", "Leituras carregadas com sucesso.");
    } catch (erro) {
        tabela.innerHTML = `<tr><td colspan="8">Não foi possível carregar. Copie o código da leitura exibido acima e tente novamente.</td></tr>`;
        atualizarResumoLeituras([]);
        atualizarStatusLeituras("erro", `Erro ao consultar o banco: ${erro.message}`);
    }
}

async function exportarLeituras() {
    const limite = elemento("limiteLeituras")?.value || "250";
    const periodo = elemento("periodoLeituras")?.value || "";
    const token = await tokenAtual("tokenLeituras");
    window.location.href = `/exportar.csv?${montarQuery({ limite, periodo, token })}`;
}

async function carregarRelatorio() {
    const container = elemento("cardsRelatorio");
    if (!container) {
        return;
    }

    const periodo = elemento("periodoRelatorio")?.value || "";
    const token = await tokenAtual("tokenRelatorio");

    try {
        const relatorio = await buscarJSON(`/relatorio?${montarQuery({ periodo, token })}`);
        const ultima = relatorio.ultima;
        container.innerHTML = `
            <div class="diagnostico-item"><strong>Total de leituras</strong><p>${relatorio.total}</p></div>
            <div class="diagnostico-item"><strong>Bateria média</strong><p>${relatorio.mediaBateria}%</p></div>
            <div class="diagnostico-item"><strong>Solar média</strong><p>${relatorio.mediaSolar}V</p></div>
            <div class="diagnostico-item"><strong>Maior corrente</strong><p>${relatorio.maiorCorrente}A</p></div>
            <div class="diagnostico-item"><strong>Menor bateria</strong><p>${relatorio.menorBateria}%</p></div>
            <div class="diagnostico-item"><strong>Menor solar</strong><p>${relatorio.menorSolar}V</p></div>
            <div class="diagnostico-item"><strong>Alertas</strong><p>${relatorio.alertas}</p></div>
            <div class="diagnostico-item"><strong>Bomba ligada</strong><p>${relatorio.bombaLigada} leituras</p></div>
            <div class="diagnostico-item"><strong>Última leitura</strong><p>${ultima ? escaparHTML(formatarDataLeitura(ultima)) : "Sem dados"}</p></div>
        `;
    } catch (erro) {
        container.innerHTML = `<div class="diagnostico-item"><strong>Erro</strong><p>${erro.message}</p></div>`;
    }
}

async function carregarAlertas() {
    const container = elemento("listaAlertas");
    if (!container) {
        return;
    }

    const periodo = elemento("periodoAlertas")?.value || "";
    const token = await tokenAtual("tokenAlertas");

    try {
        const alertas = await buscarJSON(`/alertas?${montarQuery({ periodo, token })}`);
        if (!alertas.length) {
            container.innerHTML = `<div class="diagnostico-item"><strong>Nenhum alerta</strong><p>Não há eventos críticos no período.</p></div>`;
            return;
        }

        container.innerHTML = alertas.slice().reverse().map((leitura) => `
            <div class="diagnostico-item alerta-card">
                <strong>${escaparHTML(leitura.alerta || "EVENTO")}</strong>
                <p>${escaparHTML(formatarDataLeitura(leitura))}</p>
                <p>Nível ${escaparHTML(leitura.nivel || "-")} | Bomba ${escaparHTML(leitura.bomba || "-")}</p>
                <p>Bateria ${Math.round(Number(leitura.cargaBateria || 0))}% | Solar ${Number(leitura.tensaoSolar || 0).toFixed(1)}V | Corrente ${Number(leitura.corrente || 0).toFixed(2)}A</p>
            </div>
        `).join("");
    } catch (erro) {
        container.innerHTML = `<div class="diagnostico-item"><strong>Erro</strong><p>${erro.message}</p></div>`;
    }
}

async function carregarDashboardHome() {
    const container = elemento("dashboardHome");
    if (!container) {
        return;
    }

    try {
        const token = await tokenAtual("tokenModo");
        const [dados, relatorio, saude] = await Promise.all([
            buscarJSON(`/dados?${montarQuery({ token })}`),
            buscarJSON(`/relatorio?${montarQuery({ token })}`),
            buscarJSON("/saude")
        ]);

        container.innerHTML = `
            <div class="diagnostico-item"><strong>Nível atual</strong><p>${escaparHTML(dados.nivel || "-")}</p></div>
            <div class="diagnostico-item"><strong>Bateria atual</strong><p>${Number(dados.tensaoBateria || 0).toFixed(1)}V / ${Math.round(Number(dados.cargaBateria || 0))}%</p></div>
            <div class="diagnostico-item"><strong>Total salvo</strong><p>${relatorio.total} leituras recentes</p></div>
            <div class="diagnostico-item"><strong>Último alerta</strong><p>${escaparHTML(dados.alerta || "-")}</p></div>
            <div class="diagnostico-item"><strong>Banco</strong><p>${saude.bancoTipo === "supabase" ? "Supabase" : "Arquivo local"}</p></div>
        `;
    } catch (erro) {
        container.innerHTML = `<div class="diagnostico-item"><strong>Resumo indisponível</strong><p>${erro.message}</p></div>`;
    }
}

async function buscarDadosArduino() {
    try {
        const token = await tokenAtual("tokenModo");
        const dados = await buscarJSON(`/dados?${montarQuery({ token })}`);

        if (!dados || typeof dados !== "object") {
            throw new Error("Dados inválidos recebidos");
        }

        atualizarPainel(dados);
    } catch (erro) {
        atualizarStatusConexao(false);
        tentativasConexao++;

        const mensagem = `Erro ao buscar dados: ${erro.message}`;
        if (ultimoErro !== mensagem) {
            console.warn(mensagem);
            ultimoErro = mensagem;
        }
    }
}

async function carregarDiagnostico() {
    const container = elemento("diagnosticoDados");
    if (!container) {
        return;
    }

    try {
        const token = await tokenAtual("tokenModo");
        const url = token ? `/diagnostico?token=${encodeURIComponent(token)}` : "/diagnostico";
        const dados = await buscarJSON(url);
        container.innerHTML = "";

        const itens = [
            ["Servidor", dados.statusServidor],
            ["Arduino", dados.conexaoArduino],
            ["Modo cloud", dados.modoCloud ? "Ativo" : "Inativo"],
            ["Simulação automática", dados.simulacaoAutomatica ? "Ativa" : "Inativa"],
            ["Porta Arduino", dados.portaArduino],
            ["Baud rate", dados.baudRate],
            ["Última atualização", dados.ultimaAtualizacao],
            ["Histórico", `${dados.leiturasNoHistorico} leituras`],
            ["Banco", dados.banco?.tipo === "supabase" ? "Supabase" : "Arquivo local"],
            ["Leituras salvas", `${dados.banco?.leiturasSalvas ?? 0}`],
            ["Uptime", `${dados.uptimeSegundos}s`],
            ["Memória", `${dados.memoria.heapUsadoMB} MB heap`]
        ];

        itens.forEach(([titulo, valor]) => {
            const item = document.createElement("div");
            item.className = "diagnostico-item";
            item.innerHTML = `<strong>${titulo}</strong><p>${valor}</p>`;
            container.appendChild(item);
        });
    } catch (erro) {
        container.innerHTML = `<div class="diagnostico-item"><strong>Erro</strong><p>${erro.message}</p></div>`;
    }
}

if (elemento("modoOperacao")) {
    carregarModoOperacao();
    elemento("aplicarModo")?.addEventListener("click", aplicarModoOperacao);
}

if (elemento(ids.nivelAgua) || elemento(ids.lcdLinha1)) {
    buscarDadosArduino();
    const intervalo = setInterval(buscarDadosArduino, 1000);

    setInterval(() => {
        if (tentativasConexao > 30) {
            console.error("Muitas falhas na conexão. Verifique se o servidor está rodando.");
            clearInterval(intervalo);
        }
    }, 5000);
}

if (elemento("diagnosticoDados")) {
    carregarDiagnostico();
    setInterval(carregarDiagnostico, 3000);
}

if (elemento("tabelaLeituras")) {
    carregarLeituras();
    elemento("atualizarLeituras")?.addEventListener("click", carregarLeituras);
    elemento("limiteLeituras")?.addEventListener("change", carregarLeituras);
    elemento("periodoLeituras")?.addEventListener("change", carregarLeituras);
    elemento("exportarLeituras")?.addEventListener("click", exportarLeituras);
}

if (elemento("cardsRelatorio")) {
    carregarRelatorio();
    elemento("atualizarRelatorio")?.addEventListener("click", carregarRelatorio);
    elemento("periodoRelatorio")?.addEventListener("change", carregarRelatorio);
}

if (elemento("listaAlertas")) {
    carregarAlertas();
    elemento("atualizarAlertas")?.addEventListener("click", carregarAlertas);
    elemento("periodoAlertas")?.addEventListener("change", carregarAlertas);
}

if (elemento("dashboardHome")) {
    carregarDashboardHome();
}

window.addEventListener("resize", desenharGrafico);
configurarBotaoTopo();
