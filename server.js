// server.js - Versão 3.0 com Gestão de Inventário e Registos Apagados

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÃO ---
app.use(cors());
app.use(express.json());

// --- SERVIR O SITE (FRONTEND) ---
const publicPath = path.join(__dirname);
app.use(express.static(publicPath));

// --- CONEXÃO COM O SQLITE ---
const dbPath = '/data';
const dbFile = path.join(dbPath, 'garcia_database.db');

const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        return console.error(`Erro ao conectar ao DB: ${err.message}`);
    }
    console.log(`Conectado ao banco de dados SQLite em: ${dbFile}`);
});

// --- ESTRUTURA DO BANCO DE DADOS (COM CORREÇÕES E NOVAS TABELAS) ---
db.serialize(() => {
    // Garante que a tabela de clientes tem a coluna telefone
    db.run(`ALTER TABLE clientes ADD COLUMN telefone TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error("Erro ao adicionar coluna 'telefone':", err.message);
        } else {
            console.log("Coluna 'telefone' verificada/adicionada em clientes.");
        }
    });

    // Tabela de clientes (sem alterações na estrutura base)
    db.run(`
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            tipo TEXT NOT NULL,
            endereco TEXT NOT NULL,
            numero TEXT NOT NULL,
            telefone TEXT
        )`);

    // Tabela de usuários (sem alterações)
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL
        )`);

    // Tabela de histórico (sem alterações)
    db.run(`
        CREATE TABLE IF NOT EXISTS historico (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
            data_emprestimo TEXT NOT NULL,
            marca_casco TEXT,
            tamanho_casco TEXT,
            qtd_casco INTEGER DEFAULT 0,
            qtd_casco_devolvido INTEGER DEFAULT 0,
            tipo_caixa TEXT,
            qtd_caixa INTEGER DEFAULT 0,
            qtd_caixa_devolvido INTEGER DEFAULT 0
        )`);

    // Tabela de Inventário (Estoque)
    db.run(`
        CREATE TABLE IF NOT EXISTS estoque (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            quantidade INTEGER NOT NULL
        )`);
        
    // NOVA: Tabela para registar empréstimos apagados
    db.run(`
        CREATE TABLE IF NOT EXISTS registros_apagados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dados_originais TEXT NOT NULL,
            justificativa TEXT NOT NULL,
            data_apagado TEXT NOT NULL
        )`);

    // Inicializa o inventário se estiver vazio
    const itensEstoque = [
        { id: 'vasilhame_ambev', nome: 'Vasilhame AMBEV (Brahma/Skol/Original/Bohemia)' },
        { id: 'vasilhame_brasilkirin', nome: 'Vasilhame BRASIL KIRIN (Devassa/Amstel)' },
        { id: 'vasilhame_petropolis', nome: 'Vasilhame PETRÓPOLIS (Itaipava)' },
        { id: 'vasilhame_heineken', nome: 'Vasilhame Heineken 600ml' },
        { id: 'vasilhame_stella', nome: 'Vasilhame Stella 600ml' },
        { id: 'vasilhame_cocacola', nome: 'Vasilhame Coca Cola 1L' },
        { id: 'caixa_ambev_azul', nome: 'Caixa Ambev Azul' },
        { id: 'caixa_brasilkirin_amarela', nome: 'Caixa Brasil Kirin Amarela' },
        { id: 'caixa_itaipava_vermelha', nome: 'Caixa Itaipava Vermelha' },
        { id: 'caixa_cocacola_ls', nome: 'Caixa Coca Cola LS 1L' },
        { id: 'caixa_ambev_1l', nome: 'Caixa Ambev 1L' },
        { id: 'caixa_heineken_600ml', nome: 'Caixa Heineken 600ml' }
    ];

    itensEstoque.forEach(item => {
        db.run('INSERT OR IGNORE INTO estoque (id, nome, quantidade) VALUES (?, ?, 0)', [item.id, item.nome]);
    });
});

// --- LÓGICA DE GRUPOS DE INVENTÁRIO ---
const getItemDeEstoqueId = (tipo, item) => {
    if (tipo === 'casco') {
        if (['Brahma', 'Skol', 'Bohemia', 'Original'].includes(item)) return 'vasilhame_ambev';
        if (['Devassa', 'Amstel'].includes(item)) return 'vasilhame_brasilkirin';
        if (['Itaipava'].includes(item)) return 'vasilhame_petropolis';
        if (['Heineken'].includes(item)) return 'vasilhame_heineken';
        if (['Stella'].includes(item)) return 'vasilhame_stella';
        if (['Coca Cola'].includes(item)) return 'vasilhame_cocacola';
    }
    if (tipo === 'caixa') {
        if (item === 'Ambev Azul') return 'caixa_ambev_azul';
        if (item === 'Brasil Kirin Amarela') return 'caixa_brasilkirin_amarela';
        if (item === 'Itaipava Vermelha') return 'caixa_itaipava_vermelha';
        if (item === 'Coca Cola LS 1L') return 'caixa_cocacola_ls';
        if (item === 'Ambev 1L Caixa') return 'caixa_ambev_1l';
        if (item === 'Heineken 600ml') return 'caixa_heineken_600ml';
    }
    return null;
};

const atualizarEstoque = (itemId, quantidade) => {
    if (!itemId) return;
    db.run('UPDATE estoque SET quantidade = quantidade + ? WHERE id = ?', [quantidade, itemId]);
};


// --- ROTAS DA API ---

// Rota de Login (sem alterações)
app.post('/api/login', (req, res) => {
    const { usuario, senha } = req.body;
    const sql = "SELECT * FROM usuarios WHERE nome = ?";
    db.get(sql, [usuario], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Utilizador ou palavra-passe inválidos!' });
        bcrypt.compare(senha, user.senha, (err, match) => {
            if (match) res.json({ success: true });
            else res.status(401).json({ error: 'Utilizador ou palavra-passe inválidos!' });
        });
    });
});

// === ROTAS PARA CLIENTES (ATUALIZADAS) ===

// Obter todos os clientes (agora calcula a dívida de cada um)
app.get('/api/clientes', (req, res) => {
    const sqlClientes = "SELECT * FROM clientes";
    const sqlHistorico = "SELECT cliente_id, qtd_casco, qtd_casco_devolvido, qtd_caixa, qtd_caixa_devolvido FROM historico";

    db.all(sqlClientes, [], (err, clientes) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(sqlHistorico, [], (err, historico) => {
            if (err) return res.status(500).json({ error: err.message });

            const clientesComDivida = clientes.map(cliente => {
                const dividaTotal = historico
                    .filter(h => h.cliente_id === cliente.id)
                    .reduce((acc, h) => {
                        const cascosPendentes = (h.qtd_casco || 0) - (h.qtd_casco_devolvido || 0);
                        const caixasPendentes = (h.qtd_caixa || 0) - (h.qtd_caixa_devolvido || 0);
                        return acc + cascosPendentes + caixasPendentes;
                    }, 0);
                return { ...cliente, dividaTotal };
            });
            res.json(clientesComDivida);
        });
    });
});


// Cadastrar novo cliente (agora inclui telefone)
app.post('/api/clientes', (req, res) => {
    const { nome, tipo, endereco, numero, telefone } = req.body;
    const sql = 'INSERT INTO clientes (nome, tipo, endereco, numero, telefone) VALUES (?, ?, ?, ?, ?)';
    db.run(sql, [nome.toUpperCase(), tipo, endereco, numero, telefone], function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao registar cliente. O nome já pode existir.' });
        res.status(201).json({ id: this.lastID, nome, tipo, endereco, numero, telefone });
    });
});

// Editar cliente (agora inclui telefone)
app.put('/api/clientes/:id', (req, res) => {
    const { id } = req.params;
    const { nome, tipo, endereco, numero, telefone } = req.body;
    const sql = 'UPDATE clientes SET nome = ?, tipo = ?, endereco = ?, numero = ?, telefone = ? WHERE id = ?';
    db.run(sql, [nome.toUpperCase(), tipo, endereco, numero, telefone, id], function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao atualizar cliente.' });
        res.json({ message: 'Cliente atualizado com sucesso' });
    });
});

// === ROTAS PARA HISTÓRICO (ATUALIZADAS PARA CONTROLAR ESTOQUE) ===

// Obter todo o histórico (sem alterações)
app.get('/api/historico', (req, res) => {
    const sql = `
        SELECT h.*, c.nome as cliente_nome, c.endereco as cliente_endereco, c.numero as cliente_numero
        FROM historico h
        JOIN clientes c ON h.cliente_id = c.id
        ORDER BY h.data_emprestimo DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Registrar novo empréstimo (agora diminui o estoque)
app.post('/api/historico', (req, res) => {
    const { cliente_id, marcaCasco, tamanhoCasco, qtdCasco, tipoCaixa, qtdCaixa, dataEmprestimo } = req.body;
    
    // Diminui do estoque
    if (qtdCasco > 0) {
        const itemId = getItemDeEstoqueId('casco', marcaCasco);
        atualizarEstoque(itemId, -qtdCasco);
    }
    if (qtdCaixa > 0) {
        const itemId = getItemDeEstoqueId('caixa', tipoCaixa);
        atualizarEstoque(itemId, -qtdCaixa);
    }

    const data = dataEmprestimo ? new Date(dataEmprestimo).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
    const sql = `
        INSERT INTO historico (cliente_id, marca_casco, tamanho_casco, qtd_casco, tipo_caixa, qtd_caixa, data_emprestimo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [cliente_id, marcaCasco, tamanhoCasco, qtdCasco, tipoCaixa, qtdCaixa, data];

    db.run(sql, values, function(err) {
        if (err) return res.status(500).json({ error: 'Erro ao registar empréstimo.' });
        res.status(201).json({ id: this.lastID });
    });
});

// Realizar devolução (agora aumenta o estoque)
app.post('/api/historico/devolver/:id', (req, res) => {
    const { id } = req.params;
    const { qtdCascoDev, qtdCaixaDev } = req.body;

    // Aumenta o estoque antes de registar a devolução
    db.get('SELECT * FROM historico WHERE id = ?', [id], (err, registro) => {
        if (err || !registro) return res.status(404).json({ error: 'Registo não encontrado' });
        
        if (qtdCascoDev > 0) {
            const itemId = getItemDeEstoqueId('casco', registro.marca_casco);
            atualizarEstoque(itemId, qtdCascoDev);
        }
        if (qtdCaixaDev > 0) {
            const itemId = getItemDeEstoqueId('caixa', registro.tipo_caixa);
            atualizarEstoque(itemId, qtdCaixaDev);
        }

        const sql = `
            UPDATE historico
            SET qtd_casco_devolvido = COALESCE(qtd_casco_devolvido, 0) + ?,
                qtd_caixa_devolvido = COALESCE(qtd_caixa_devolvido, 0) + ?
            WHERE id = ?
        `;
        db.run(sql, [qtdCascoDev, qtdCaixaDev, id], function(err) {
            if (err) return res.status(500).json({ error: 'Erro ao confirmar devolução.' });
            res.json({ message: 'Devolução registada com sucesso' });
        });
    });
});

// NOVA: Rota para apagar um registo de histórico
app.delete('/api/historico/:id', (req, res) => {
    const { id } = req.params;
    const { justificativa } = req.body;

    if (!justificativa) {
        return res.status(400).json({ error: 'A justificativa é obrigatória.' });
    }

    db.get('SELECT * FROM historico WHERE id = ?', [id], (err, registro) => {
        if (err || !registro) return res.status(404).json({ error: 'Registo não encontrado' });

        // 1. Devolve os itens pendentes ao estoque
        const cascosPendentes = (registro.qtd_casco || 0) - (registro.qtd_casco_devolvido || 0);
        const caixasPendentes = (registro.qtd_caixa || 0) - (registro.qtd_caixa_devolvido || 0);

        if (cascosPendentes > 0) {
            const itemId = getItemDeEstoqueId('casco', registro.marca_casco);
            atualizarEstoque(itemId, cascosPendentes);
        }
        if (caixasPendentes > 0) {
            const itemId = getItemDeEstoqueId('caixa', registro.tipo_caixa);
            atualizarEstoque(itemId, caixasPendentes);
        }

        // 2. Guarda o registo na tabela de apagados
        const dadosOriginais = JSON.stringify(registro);
        const dataApagado = new Date().toLocaleString('pt-BR');
        const sqlInsertApagado = 'INSERT INTO registros_apagados (dados_originais, justificativa, data_apagado) VALUES (?, ?, ?)';
        
        db.run(sqlInsertApagado, [dadosOriginais, justificativa, dataApagado], (err) => {
            if (err) return res.status(500).json({ error: 'Erro ao arquivar o registo apagado.' });

            // 3. Apaga o registo original
            db.run('DELETE FROM historico WHERE id = ?', [id], function(err) {
                if (err) return res.status(500).json({ error: 'Erro ao apagar o registo original.' });
                res.json({ message: 'Registo apagado e arquivado com sucesso.' });
            });
        });
    });
});

// NOVA: Rota para obter os registos apagados
app.get('/api/registros-apagados', (req, res) => {
    db.all('SELECT * FROM registros_apagados ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});


// === ROTAS PARA ESTOQUE ===

// Obter o estado atual do estoque
app.get('/api/estoque', (req, res) => {
    db.all('SELECT * FROM estoque', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Atualizar um item do estoque
app.post('/api/estoque/:id', (req, res) => {
    const { id } = req.params;
    const { quantidade } = req.body;
    db.run('UPDATE estoque SET quantidade = ? WHERE id = ?', [quantidade, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Estoque atualizado com sucesso' });
    });
});


// --- INICIAR SERVIDOR ---
app.listen(port, () => {
    console.log(`Servidor a funcionar na porta ${port}`);

    // Script para criar o utilizador inicial, se não existir
    const initialUser = 'junior';
    const initialPass = 'garcia2017';

    db.get("SELECT * FROM usuarios WHERE nome = ?", [initialUser], (err, row) => {
        if (!row) {
            bcrypt.hash(initialPass, 10, (err, hash) => {
                if (err) return console.error('Erro ao gerar hash', err);
                db.run('INSERT INTO usuarios (nome, senha) VALUES (?, ?)', [initialUser, hash], (err) => {
                    if (!err) console.log(`Utilizador "${initialUser}" criado com sucesso.`);
                });
            });
        }
    });
});
