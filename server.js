// server.js - Versão 4.1 (datas estáveis + notificações + hoje com intervalo)

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
  if (err) return console.error(`Erro ao conectar ao DB: ${err.message}`);
  console.log(`Conectado ao banco SQLite: ${dbFile}`);
});

/* ===================== HELPERS DE DATA (America/Recife) ===================== */
const TZ = 'America/Recife';

/** retorna {yyyy, mm, dd, HH, MM, SS} da data atual em America/Recife */
function nowRecifeParts() {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  // parts.day (dd), parts.month (mm), parts.year (aaaa), parts.hour, parts.minute, parts.second
  return {
    yyyy: parts.year,
    mm: parts.month,
    dd: parts.day,
    HH: parts.hour,
    MM: parts.minute,
    SS: parts.second
  };
}

/** "YYYY-MM-DD HH:MM:SS" a partir das parts do Recife */
function partsToSql({yyyy, mm, dd, HH='00', MM='00', SS='00'}) {
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}

/** agora em Recife como "YYYY-MM-DD HH:MM:SS" */
function nowSqlRecife() {
  return partsToSql(nowRecifeParts());
}

/** Normaliza várias entradas de data para "YYYY-MM-DD HH:MM:SS" (local) */
function toSqlDateTime(input) {
  if (!input) return null;
  if (typeof input !== 'string') return null;
  const s = input.trim();

  // 1) "YYYY-MM-DDTHH:MM" (do <input type="datetime-local">)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, mi, se='00'] = m;
    return `${y}-${mo}-${d} ${h}:${mi}:${se.padStart(2,'0')}`;
  }

  // 2) "YYYY-MM-DD HH:MM:SS"
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return s.replace('T',' ');

  // 3) "DD/MM/YYYY HH:MM:SS" ou "DD/MM/YYYY HH:MM"
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, d, mo, y, h='00', mi='00', se='00'] = m;
    return `${y}-${mo}-${d} ${h}:${mi}:${se.padStart(2,'0')}`;
  }

  // 4) "DD/MM/YYYY"
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo}-${d} 00:00:00`;
  }

  // fallback: tenta Date() e formata em Recife
  const dt = new Date(s);
  if (!isNaN(dt)) {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const parts = Object.fromEntries(fmt.formatToParts(dt).map(p => [p.type, p.value]));
    return partsToSql({
      yyyy: parts.year, mm: parts.month, dd: parts.day,
      HH: parts.hour, MM: parts.minute, SS: parts.second
    });
  }
  return null;
}

/** Retorna [inicioDoDia, fimDoDia] em Recife, formato SQL */
function hojeIntervaloSql() {
  const p = nowRecifeParts();
  return [
    partsToSql({yyyy: p.yyyy, mm: p.mm, dd: p.dd, HH: '00', MM: '00', SS: '00'}),
    partsToSql({yyyy: p.yyyy, mm: p.mm, dd: p.dd, HH: '23', MM: '59', SS: '59'}),
  ];
}

/* ===================== ESTRUTURA DO BANCO ===================== */
db.serialize(() => {
  // Campos opcionais que podem não existir em bancos antigos
  db.run(`ALTER TABLE clientes ADD COLUMN telefone TEXT`, () => {});
  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      tipo TEXT NOT NULL,
      endereco TEXT NOT NULL,
      numero TEXT NOT NULL,
      telefone TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      data_emprestimo TEXT NOT NULL,             -- "YYYY-MM-DD HH:MM:SS" (Recife)
      data_devolucao TEXT,                       -- NOVO: data limite para devolução
      marca_casco TEXT,
      tamanho_casco TEXT,
      qtd_casco INTEGER DEFAULT 0,
      qtd_casco_devolvido INTEGER DEFAULT 0,
      tipo_caixa TEXT,
      qtd_caixa INTEGER DEFAULT 0,
      qtd_caixa_devolvido INTEGER DEFAULT 0
    )
  `);
  // Em bancos antigos, garante a coluna data_devolucao
  db.run(`ALTER TABLE historico ADD COLUMN data_devolucao TEXT`, () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS estoque (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      quantidade INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS registros_apagados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dados_originais TEXT NOT NULL,
      justificativa TEXT NOT NULL,
      data_apagado TEXT NOT NULL
    )
  `);

  // Itens de estoque
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

/* ===================== LÓGICA DE GRUPOS DE INVENTÁRIO ===================== */
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

/* ===================== ROTAS ===================== */

// Login
app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body;
  const sql = 'SELECT * FROM usuarios WHERE nome = ?';
  db.get(sql, [usuario], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Utilizador ou palavra-passe inválidos!' });
    bcrypt.compare(senha, user.senha, (err, ok) => {
      if (ok) res.json({ success: true });
      else res.status(401).json({ error: 'Utilizador ou palavra-passe inválidos!' });
    });
  });
});

// === CLIENTES ===
app.get('/api/clientes', (req, res) => {
  const sqlClientes = 'SELECT * FROM clientes';
  const sqlHistorico = 'SELECT cliente_id, qtd_casco, qtd_casco_devolvido, qtd_caixa, qtd_caixa_devolvido FROM historico';
  db.all(sqlClientes, [], (err, clientes) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all(sqlHistorico, [], (err2, hist) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const out = clientes.map(c => {
        const divida = hist
          .filter(h => h.cliente_id === c.id)
          .reduce((acc, h) => acc +
            ((h.qtd_casco || 0) - (h.qtd_casco_devolvido || 0)) +
            ((h.qtd_caixa || 0) - (h.qtd_caixa_devolvido || 0)), 0);
        return { ...c, dividaTotal: divida };
      });
      res.json(out);
    });
  });
});

app.post('/api/clientes', (req, res) => {
  const { nome, tipo, endereco, numero, telefone } = req.body;
  const sql = 'INSERT INTO clientes (nome, tipo, endereco, numero, telefone) VALUES (?, ?, ?, ?, ?)';
  db.run(sql, [nome.toUpperCase(), tipo, endereco, numero, telefone], function(err) {
    if (err) return res.status(500).json({ error: 'Erro ao registar cliente. O nome já pode existir.' });
    res.status(201).json({ id: this.lastID, nome, tipo, endereco, numero, telefone });
  });
});

app.put('/api/clientes/:id', (req, res) => {
  const { id } = req.params;
  const { nome, tipo, endereco, numero, telefone } = req.body;
  const sql = 'UPDATE clientes SET nome = ?, tipo = ?, endereco = ?, numero = ?, telefone = ? WHERE id = ?';
  db.run(sql, [nome.toUpperCase(), tipo, endereco, numero, telefone, id], function(err) {
    if (err) return res.status(500).json({ error: 'Erro ao atualizar cliente.' });
    res.json({ message: 'Cliente atualizado com sucesso' });
  });
});

// === HISTÓRICO ===

// Todos
app.get('/api/historico', (req, res) => {
  const sql = `
    SELECT h.*, c.nome AS cliente_nome, c.endereco AS cliente_endereco, c.numero AS cliente_numero
    FROM historico h
    JOIN clientes c ON h.cliente_id = c.id
    ORDER BY datetime(h.data_emprestimo) DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Hoje (intervalo em Recife)
app.get('/api/historico/hoje', (req, res) => {
  const [inicio, fim] = hojeIntervaloSql(); // "YYYY-MM-DD 00:00:00" .. "YYYY-MM-DD 23:59:59"
  const sql = `
    SELECT h.*, c.nome AS cliente_nome
    FROM historico h
    JOIN clientes c ON h.cliente_id = c.id
    WHERE datetime(h.data_emprestimo) BETWEEN datetime(?) AND datetime(?)
    ORDER BY datetime(h.data_emprestimo) DESC
  `;
  db.all(sql, [inicio, fim], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Novo empréstimo (aceita data_emprestimo e data_devolucao opcionais)
app.post('/api/historico', (req, res) => {
  let { cliente_id, marcaCasco, tamanhoCasco, qtdCasco, tipoCaixa, qtdCaixa, data_emprestimo, data_devolucao } = req.body;

  // normaliza datas
  const dataEmp = toSqlDateTime(data_emprestimo) || nowSqlRecife();
  const dataDev = toSqlDateTime(data_devolucao); // pode ser null

  // estoque
  if ((qtdCasco|0) > 0) {
    const itemId = getItemDeEstoqueId('casco', marcaCasco);
    atualizarEstoque(itemId, -(qtdCasco|0));
  }
  if ((qtdCaixa|0) > 0) {
    const itemId = getItemDeEstoqueId('caixa', tipoCaixa);
    atualizarEstoque(itemId, -(qtdCaixa|0));
  }

  const sql = `
    INSERT INTO historico
      (cliente_id, marca_casco, tamanho_casco, qtd_casco, tipo_caixa, qtd_caixa, data_emprestimo, data_devolucao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [cliente_id, marcaCasco, tamanhoCasco, (qtdCasco|0), tipoCaixa, (qtdCaixa|0), dataEmp, dataDev];

  db.run(sql, values, function(err) {
    if (err) return res.status(500).json({ error: 'Erro ao registar empréstimo.' });
    res.status(201).json({ id: this.lastID });
  });
});

// Devolução
app.post('/api/historico/devolver/:id', (req, res) => {
  const { id } = req.params;
  const { qtdCascoDev = 0, qtdCaixaDev = 0 } = req.body;

  db.get('SELECT * FROM historico WHERE id = ?', [id], (err, registro) => {
    if (err || !registro) return res.status(404).json({ error: 'Registo não encontrado' });

    if ((qtdCascoDev|0) > 0) {
      const itemId = getItemDeEstoqueId('casco', registro.marca_casco);
      atualizarEstoque(itemId, (qtdCascoDev|0));
    }
    if ((qtdCaixaDev|0) > 0) {
      const itemId = getItemDeEstoqueId('caixa', registro.tipo_caixa);
      atualizarEstoque(itemId, (qtdCaixaDev|0));
    }

    const sql = `
      UPDATE historico
      SET qtd_casco_devolvido = COALESCE(qtd_casco_devolvido, 0) + ?,
          qtd_caixa_devolvido = COALESCE(qtd_caixa_devolvido, 0) + ?
      WHERE id = ?
    `;
    db.run(sql, [(qtdCascoDev|0), (qtdCaixaDev|0), id], function(err2) {
      if (err2) return res.status(500).json({ error: 'Erro ao confirmar devolução.' });
      res.json({ message: 'Devolução registada com sucesso' });
    });
  });
});

// Apagar registro
app.delete('/api/historico/:id', (req, res) => {
  const { id } = req.params;
  const { justificativa } = req.body;
  if (!justificativa) return res.status(400).json({ error: 'A justificativa é obrigatória.' });

  db.get('SELECT * FROM historico WHERE id = ?', [id], (err, registro) => {
    if (err || !registro) return res.status(404).json({ error: 'Registo não encontrado' });

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

    const dadosOriginais = JSON.stringify(registro);
    const dataApagado = nowSqlRecife();
    const sqlIns = 'INSERT INTO registros_apagados (dados_originais, justificativa, data_apagado) VALUES (?, ?, ?)';
    db.run(sqlIns, [dadosOriginais, justificativa, dataApagado], (err2) => {
      if (err2) return res.status(500).json({ error: 'Erro ao arquivar o registo apagado.' });
      db.run('DELETE FROM historico WHERE id = ?', [id], (err3) => {
        if (err3) return res.status(500).json({ error: 'Erro ao apagar o registo original.' });
        res.json({ message: 'Registo apagado e arquivado com sucesso.' });
      });
    });
  });
});

// Registros apagados
app.get('/api/registros-apagados', (req, res) => {
  db.all('SELECT * FROM registros_apagados ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// === ESTOQUE ===
app.get('/api/estoque', (req, res) => {
  db.all('SELECT * FROM estoque', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/estoque/:id', (req, res) => {
  const { id } = req.params;
  const { quantidade } = req.body;
  db.run('UPDATE estoque SET quantidade = ? WHERE id = ?', [quantidade, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Estoque atualizado com sucesso' });
  });
});

/* ===================== NOTIFICAÇÕES (NOVO) ===================== */
/**
 * Retorna registros com itens pendentes e data_devolucao <= agora.
 * GET /api/notificacoes
 * Saída: [{ id, cliente_id, cliente_nome, data_devolucao, dias_atraso, ... }]
 */
app.get('/api/notificacoes', (req, res) => {
  const agora = nowSqlRecife();
  const sql = `
    SELECT h.*, c.nome AS cliente_nome
    FROM historico h
    JOIN clientes c ON h.cliente_id = c.id
    WHERE h.data_devolucao IS NOT NULL
      AND ( (COALESCE(h.qtd_casco,0) - COALESCE(h.qtd_casco_devolvido,0)) > 0
            OR (COALESCE(h.qtd_caixa,0) - COALESCE(h.qtd_caixa_devolvido,0)) > 0 )
      AND datetime(h.data_devolucao) <= datetime(?)
    ORDER BY datetime(h.data_devolucao) ASC
  `;
  db.all(sql, [agora], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // calcula dias_atraso
    const out = rows.map(r => {
      // parse "YYYY-MM-DD HH:MM:SS"
      const m = (r.data_devolucao || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      let dias_atraso = 0;
      if (m) {
        const [ , y, mo, d ] = m;
        const due = new Date(`${y}-${mo}-${d}T00:00:00`);
        const today = new Date(); // diferença de dias ~ ok para exibição
        dias_atraso = Math.max(0, Math.floor((today - due) / 86400000));
      }
      return { ...r, dias_atraso };
    });
    res.json(out);
  });
});

// --- INICIAR SERVIDOR ---
app.listen(port, () => {
  console.log(`Servidor a funcionar na porta ${port}`);

  const initialUser = 'junior';
  const initialPass = 'garcia2017';

  db.get('SELECT * FROM usuarios WHERE nome = ?', [initialUser], (err, row) => {
    if (!row) {
      bcrypt.hash(initialPass, 10, (err2, hash) => {
        if (err2) return console.error('Erro ao gerar hash', err2);
        db.run('INSERT INTO usuarios (nome, senha) VALUES (?, ?)', [initialUser, hash], (err3) => {
          if (!err3) console.log(`Utilizador "${initialUser}" criado com sucesso.`);
        });
      });
    }
  });
});
