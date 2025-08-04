// server.js - Versão Final com SQLite

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
const port = 3000; // Porta onde o servidor vai rodar

// --- CONFIGURAÇÃO ---

// Middleware
app.use(cors()); // Permite requisições de outras origens
app.use(express.json()); // Permite que o express entenda JSON no corpo das requisições

// Conexão com o SQLite
// Conecta (ou cria se não existir) ao arquivo do banco de dados.
const db = new sqlite3.Database('./garcia_database.db', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Conectado ao banco de dados SQLite.');
});

// Cria as tabelas se elas não existirem
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            tipo TEXT NOT NULL,
            endereco TEXT NOT NULL,
            numero TEXT NOT NULL
        )`);

    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL
        )`);

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
});


// --- ROTAS DA API ---

// Rota de Login
app.post('/api/login', (req, res) => {
    const { usuario, senha } = req.body;
    const sql = "SELECT * FROM usuarios WHERE nome = ?";
    
    db.get(sql, [usuario], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos!' });
        }
        
        bcrypt.compare(senha, user.senha, (err, match) => {
            if (err) {
                 return res.status(500).json({ error: 'Erro ao verificar senha' });
            }
            if (match) {
                res.json({ success: true });
            } else {
                res.status(401).json({ error: 'Usuário ou senha inválidos!' });
            }
        });
    });
});


// === ROTAS PARA CLIENTES ===

// Obter todos os clientes
app.get('/api/clientes', (req, res) => {
    const sql = "SELECT * FROM clientes ORDER BY nome ASC";
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Cadastrar novo cliente
app.post('/api/clientes', (req, res) => {
    const { nome, tipo, endereco, numero } = req.body;
    const sql = 'INSERT INTO clientes (nome, tipo, endereco, numero) VALUES (?, ?, ?, ?)';
    
    db.run(sql, [nome.toUpperCase(), tipo, endereco, numero], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao cadastrar cliente. O nome já pode existir.' });
        }
        res.status(201).json({ id: this.lastID, nome, tipo, endereco, numero });
    });
});

// Editar cliente
app.put('/api/clientes/:id', (req, res) => {
    const { id } = req.params;
    const { nome, tipo, endereco, numero } = req.body;
    const sql = 'UPDATE clientes SET nome = ?, tipo = ?, endereco = ?, numero = ? WHERE id = ?';
    
    db.run(sql, [nome.toUpperCase(), tipo, endereco, numero, id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao atualizar cliente.' });
        }
        res.json({ message: 'Cliente atualizado com sucesso' });
    });
});


// === ROTAS PARA HISTÓRICO ===

// Obter todo o histórico
app.get('/api/historico', (req, res) => {
    const sql = `
        SELECT h.*, c.nome as cliente_nome, c.endereco as cliente_endereco, c.numero as cliente_numero
        FROM historico h
        JOIN clientes c ON h.cliente_id = c.id
        ORDER BY h.data_emprestimo DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Registrar novo empréstimo
app.post('/api/historico', (req, res) => {
    const { cliente_id, marcaCasco, tamanhoCasco, qtdCasco, tipoCaixa, qtdCaixa, dataEmprestimo } = req.body;
    const data = dataEmprestimo ? new Date(dataEmprestimo).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
    const sql = `
        INSERT INTO historico (cliente_id, marca_casco, tamanho_casco, qtd_casco, tipo_caixa, qtd_caixa, data_emprestimo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [cliente_id, marcaCasco, tamanhoCasco, qtdCasco, tipoCaixa, qtdCaixa, data];

    db.run(sql, values, function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao registrar empréstimo.' });
        }
        res.status(201).json({ id: this.lastID });
    });
});

// Realizar devolução
app.post('/api/historico/devolver/:id', (req, res) => {
    const { id } = req.params;
    const { qtdCascoDev, qtdCaixaDev } = req.body;
    const sql = `
        UPDATE historico
        SET qtd_casco_devolvido = COALESCE(qtd_casco_devolvido, 0) + ?,
            qtd_caixa_devolvido = COALESCE(qtd_caixa_devolvido, 0) + ?
        WHERE id = ?
    `;
    db.run(sql, [qtdCascoDev, qtdCaixaDev, id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao confirmar devolução.' });
        }
        res.json({ message: 'Devolução registrada com sucesso' });
    });
});


// --- INICIAR SERVIDOR ---
app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);

    // Script para criar o usuário inicial, se não existir
    const initialUser = 'junior';
    const initialPass = 'garcia2017';

    db.get("SELECT * FROM usuarios WHERE nome = ?", [initialUser], (err, row) => {
        if (!row) {
            bcrypt.hash(initialPass, 10, (err, hash) => {
                if (err) return console.error('Erro ao gerar hash', err);
                db.run('INSERT INTO usuarios (nome, senha) VALUES (?, ?)', [initialUser, hash], (err) => {
                    if (!err) console.log(`Usuário "${initialUser}" criado com sucesso.`);
                });
            });
        }
    });
});
