// server.js - Versão 8 - com vendedor + edição com justificativa
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIG ---
app.use(cors());
app.use(express.json());

// --- STATIC ---
const publicPath = path.join(__dirname);
app.use(express.static(publicPath));

// --- DB ---
const dbPath = '/data';
const dbFile = path.join(dbPath, 'garcia_database.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) return console.error(`Erro ao conectar ao DB: ${err.message}`);
  console.log(`Conectado ao banco SQLite: ${dbFile}`);
});

/* ===================== DATA (America/Recife) ===================== */
const TZ = 'America/Recife';
function partsToSql({yyyy, mm, dd, HH='00', MM='00', SS='00'}) {
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}
function nowRecifeParts() {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x=>[x.type,x.value]));
  return { yyyy:p.year, mm:p.month, dd:p.day, HH:p.hour, MM:p.minute, SS:p.second };
}
function nowSqlRecife(){ return partsToSql(nowRecifeParts()); }
function toSqlDateTime(input){
  if (!input || typeof input!=='string') return null;
  const s=input.trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m){ const[,y,mo,d,h,mi,se='00']=m; return `${y}-${mo}-${d} ${h}:${mi}:${se.padStart(2,'0')}`; }
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return s.replace('T',' ');
  m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m){ const[,d,mo,y,h='00',mi='00',se='00']=m; return `${y}-${mo}-${d} ${h}:${mi}:${se.padStart(2,'0')}`; }
  m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m){ const[,d,mo,y]=m; return `${y}-${mo}-${d} 00:00:00`; }
  // fallback timezone Recife
  const dt = new Date(s);
  if (!isNaN(dt)){
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
    });
    const p=Object.fromEntries(fmt.formatToParts(dt).map(x=>[x.type,x.value]));
    return partsToSql({yyyy:p.year, mm:p.month, dd:p.day, HH:p.hour, MM:p.minute, SS:p.second});
  }
  return null;
}
function hojeIntervaloSql(){
  const p=nowRecifeParts();
  return [
    partsToSql({yyyy:p.yyyy,mm:p.mm,dd:p.dd,HH:'00',MM:'00',SS:'00'}),
    partsToSql({yyyy:p.yyyy,mm:p.mm,dd:p.dd,HH:'23',MM:'59',SS:'59'}),
  ];
}

/* ===================== SCHEMA ===================== */
db.serialize(()=>{
  db.run(`CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT UNIQUE NOT NULL,
    tipo TEXT NOT NULL,
    endereco TEXT NOT NULL,
    numero TEXT NOT NULL,
    telefone TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    data_emprestimo TEXT NOT NULL,
    data_devolucao TEXT,
    vendedor TEXT,                           -- NOVO
    marca_casco TEXT,
    tamanho_casco TEXT,
    qtd_casco INTEGER DEFAULT 0,
    qtd_casco_devolvido INTEGER DEFAULT 0,
    tipo_caixa TEXT,
    qtd_caixa INTEGER DEFAULT 0,
    qtd_caixa_devolvido INTEGER DEFAULT 0,
    alterado_por TEXT,                       -- NOVO
    justificativa_alteracao TEXT,            -- NOVO
    data_alteracao TEXT                      -- NOVO
  )`);

  // migrações "best effort"
  ['telefone'].forEach(col=> db.run(`ALTER TABLE clientes ADD COLUMN ${col} TEXT`, ()=>{}));
  ['data_devolucao','vendedor','alterado_por','justificativa_alteracao','data_alteracao'].forEach(col=>
    db.run(`ALTER TABLE historico ADD COLUMN ${col} TEXT`, ()=>{})
  );

  db.run(`CREATE TABLE IF NOT EXISTS estoque (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    quantidade INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS registros_apagados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dados_originais TEXT NOT NULL,
    justificativa TEXT NOT NULL,
    data_apagado TEXT NOT NULL
  )`);

  // Tabela de auditoria de edições
  db.run(`CREATE TABLE IF NOT EXISTS historico_edicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    historico_id INTEGER NOT NULL,
    dados_antes TEXT NOT NULL,
    dados_depois TEXT NOT NULL,
    justificativa TEXT NOT NULL,
    alterado_por TEXT NOT NULL,
    data_alteracao TEXT NOT NULL
  )`);

  // Popular estoque se faltando
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
  itensEstoque.forEach(it=> db.run('INSERT OR IGNORE INTO estoque (id,nome,quantidade) VALUES(?,?,0)', [it.id,it.nome]));

});

/* ===================== ESTOQUE HELPERS ===================== */
const getItemDeEstoqueId = (tipo, item) => {
  if (tipo === 'casco') {
    if (['Brahma','Skol','Bohemia','Original'].includes(item)) return 'vasilhame_ambev';
    if (['Devassa','Amstel'].includes(item)) return 'vasilhame_brasilkirin';
    if (['Itaipava'].includes(item)) return 'vasilhame_petropolis';
    if (['Heineken'].includes(item)) return 'vasilhame_heineken';
    if (['Stella'].includes(item)) return 'vasilhame_stella';
    if (['Coca Cola'].includes(item)) return 'vasilhame_cocacola';
  }
  if (tipo === 'caixa') {
    if (item==='Ambev Azul') return 'caixa_ambev_azul';
    if (item==='Brasil Kirin Amarela') return 'caixa_brasilkirin_amarela';
    if (item==='Itaipava Vermelha') return 'caixa_itaipava_vermelha';
    if (item==='Coca Cola LS 1L') return 'caixa_cocacola_ls';
    if (item==='Ambev 1L Caixa') return 'caixa_ambev_1l';
    if (item==='Heineken 600ml') return 'caixa_heineken_600ml';
  }
  return null;
};
const atualizarEstoque = (itemId, quantidade) => {
  if (!itemId || !quantidade) return;
  db.run('UPDATE estoque SET quantidade = quantidade + ? WHERE id = ?', [quantidade, itemId]);
};

/* ===================== ROTAS ===================== */
// Login
app.post('/api/login', (req,res)=>{
  const { usuario, senha } = req.body;
  db.get('SELECT * FROM usuarios WHERE nome = ?', [usuario], (err,user)=>{
    if (err || !user) return res.status(401).json({ error:'Utilizador ou palavra-passe inválidos!' });
    bcrypt.compare(senha, user.senha, (err2, ok)=>{
      if (ok) res.json({ success:true });
      else res.status(401).json({ error:'Utilizador ou palavra-passe inválidos!' });
    });
  });
});

// Clientes
app.get('/api/clientes', (req,res)=>{
  const sqlC='SELECT * FROM clientes';
  const sqlH='SELECT cliente_id, qtd_casco, qtd_casco_devolvido, qtd_caixa, qtd_caixa_devolvido FROM historico';
  db.all(sqlC,[],(err,cls)=>{
    if (err) return res.status(500).json({error:err.message});
    db.all(sqlH,[],(err2,hst)=>{
      if (err2) return res.status(500).json({error:err2.message});
      const out=cls.map(c=>{
        const div = hst.filter(h=>h.cliente_id===c.id).reduce((acc,h)=>acc+((h.qtd_casco||0)-(h.qtd_casco_devolvido||0))+((h.qtd_caixa||0)-(h.qtd_caixa_devolvido||0)),0);
        return {...c, dividaTotal:div};
      });
      res.json(out);
    });
  });
});

app.post('/api/clientes', (req,res)=>{
  const { nome, tipo, endereco, numero, telefone } = req.body;
  const sql='INSERT INTO clientes (nome,tipo,endereco,numero,telefone) VALUES (?,?,?,?,?)';
  db.run(sql, [nome.toUpperCase(), tipo, endereco, numero, telefone], function(err){
    if (err) return res.status(500).json({error:'Erro ao registar cliente. O nome já pode existir.'});
    res.status(201).json({ id:this.lastID, nome, tipo, endereco, numero, telefone });
  });
});

app.put('/api/clientes/:id', (req,res)=>{
  const { id } = req.params;
  const { nome, tipo, endereco, numero, telefone } = req.body;
  db.run('UPDATE clientes SET nome=?, tipo=?, endereco=?, numero=?, telefone=? WHERE id=?',
    [nome.toUpperCase(), tipo, endereco, numero, telefone, id], function(err){
      if (err) return res.status(500).json({error:'Erro ao atualizar cliente.'});
      res.json({message:'Cliente atualizado com sucesso'});
    });
});

// Historico
app.get('/api/historico', (req,res)=>{
  const sql=`
    SELECT h.*, c.nome AS cliente_nome, c.endereco AS cliente_endereco, c.numero AS cliente_numero
    FROM historico h JOIN clientes c ON h.cliente_id=c.id
    ORDER BY datetime(h.data_emprestimo) DESC
  `;
  db.all(sql,[],(err,rows)=>{
    if (err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});

app.get('/api/historico/hoje', (req,res)=>{
  const [ini,fim]=hojeIntervaloSql();
  const sql=`
    SELECT h.*, c.nome AS cliente_nome
    FROM historico h JOIN clientes c ON h.cliente_id=c.id
    WHERE datetime(h.data_emprestimo) BETWEEN datetime(?) AND datetime(?)
    ORDER BY datetime(h.data_emprestimo) DESC
  `;
  db.all(sql,[ini,fim],(err,rows)=>{
    if (err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});

// Novo empréstimo (com vendedor)
app.post('/api/historico', (req,res)=>{
  let { cliente_id, vendedor, marcaCasco, tamanhoCasco, qtdCasco, tipoCaixa, qtdCaixa, data_emprestimo, data_devolucao } = req.body;

  const dataEmp = toSqlDateTime(data_emprestimo) || nowSqlRecife();
  const dataDev = toSqlDateTime(data_devolucao);

  // estoque consome
  if ((qtdCasco|0)>0) atualizarEstoque(getItemDeEstoqueId('casco', marcaCasco), -(qtdCasco|0));
  if ((qtdCaixa|0)>0) atualizarEstoque(getItemDeEstoqueId('caixa', tipoCaixa), -(qtdCaixa|0));

  const sql=`
    INSERT INTO historico
      (cliente_id, vendedor, marca_casco, tamanho_casco, qtd_casco, tipo_caixa, qtd_caixa, data_emprestimo, data_devolucao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(sql, [cliente_id, vendedor || null, marcaCasco, tamanhoCasco, (qtdCasco|0), tipoCaixa, (qtdCaixa|0), dataEmp, dataDev], function(err){
    if (err) return res.status(500).json({error:'Erro ao registar empréstimo.'});
    res.status(201).json({id:this.lastID});
  });
});

// Devolver
app.post('/api/historico/devolver/:id', (req,res)=>{
  const { id } = req.params;
  const { qtdCascoDev=0, qtdCaixaDev=0 } = req.body;
  db.get('SELECT * FROM historico WHERE id=?',[id],(err,reg)=>{
    if (err || !reg) return res.status(404).json({error:'Registo não encontrado'});

    if ((qtdCascoDev|0)>0) atualizarEstoque(getItemDeEstoqueId('casco', reg.marca_casco), (qtdCascoDev|0));
    if ((qtdCaixaDev|0)>0) atualizarEstoque(getItemDeEstoqueId('caixa', reg.tipo_caixa), (qtdCaixaDev|0));

    const sql=`
      UPDATE historico
      SET qtd_casco_devolvido = COALESCE(qtd_casco_devolvido,0) + ?,
          qtd_caixa_devolvido = COALESCE(qtd_caixa_devolvido,0) + ?
      WHERE id=?
    `;
    db.run(sql, [(qtdCascoDev|0),(qtdCaixaDev|0), id], function(err2){
      if (err2) return res.status(500).json({error:'Erro ao confirmar devolução.'});
      res.json({message:'Devolução registada com sucesso'});
    });
  });
});

// EDITAR com justificativa + ajuste de estoque
app.put('/api/historico/:id', (req,res)=>{
  const { id } = req.params;
  const {
    vendedor, data_emprestimo, data_devolucao,
    marca_casco, tamanho_casco, qtd_casco,
    tipo_caixa, qtd_caixa,
    justificativa, alterado_por
  } = req.body;

  if (!justificativa || !alterado_por) return res.status(400).json({error:'justificativa e alterado_por são obrigatórios.'});

  const dataEmp = toSqlDateTime(data_emprestimo) || nowSqlRecife();
  const dataDev = toSqlDateTime(data_devolucao);

  db.get('SELECT * FROM historico WHERE id=?',[id],(err,old)=>{
    if (err || !old) return res.status(404).json({error:'Registo não encontrado'});

    // Validações: não permitir reduzir abaixo do devolvido
    const newQtdCasco = (qtd_casco|0);
    const newQtdCaixa = (qtd_caixa|0);
    if (newQtdCasco < (old.qtd_casco_devolvido||0)) return res.status(400).json({error:'Qtd de cascos não pode ser menor que a já devolvida.'});
    if (newQtdCaixa < (old.qtd_caixa_devolvido||0)) return res.status(400).json({error:'Qtd de caixas não pode ser menor que a já devolvida.'});

    // AJUSTE DE ESTOQUE (diferença entre "emprestado antes" e "agora")
    // CASCOS
    if ((old.marca_casco!==marca_casco) || (old.tamanho_casco!==tamanho_casco)){
      // devolve tudo do antigo, tira tudo do novo
      if ((old.qtd_casco|0)>0) atualizarEstoque(getItemDeEstoqueId('casco', old.marca_casco), (old.qtd_casco|0));
      if ((newQtdCasco|0)>0) atualizarEstoque(getItemDeEstoqueId('casco', marca_casco), -(newQtdCasco|0));
    } else {
      // mesma marca/tamanho -> ajusta pela diferença
      const diff = (newQtdCasco|0) - (old.qtd_casco|0);
      if (diff>0) atualizarEstoque(getItemDeEstoqueId('casco', marca_casco), -diff);
      else if (diff<0) atualizarEstoque(getItemDeEstoqueId('casco', marca_casco), -diff); // diff negativo -> adiciona
    }

    // CAIXAS
    if (old.tipo_caixa !== tipo_caixa){
      if ((old.qtd_caixa|0)>0) atualizarEstoque(getItemDeEstoqueId('caixa', old.tipo_caixa), (old.qtd_caixa|0));
      if ((newQtdCaixa|0)>0) atualizarEstoque(getItemDeEstoqueId('caixa', tipo_caixa), -(newQtdCaixa|0));
    } else {
      const diff = (newQtdCaixa|0) - (old.qtd_caixa|0);
      if (diff>0) atualizarEstoque(getItemDeEstoqueId('caixa', tipo_caixa), -diff);
      else if (diff<0) atualizarEstoque(getItemDeEstoqueId('caixa', tipo_caixa), -diff);
    }

    const dataAlt = nowSqlRecife();

    // Salva auditoria
    const dadosAntes = JSON.stringify(old);
    const dadosDepois = JSON.stringify({
      ...old,
      vendedor, data_emprestimo:dataEmp, data_devolucao:dataDev,
      marca_casco, tamanho_casco, qtd_casco:newQtdCasco,
      tipo_caixa, qtd_caixa:newQtdCaixa
    });

    db.run(`INSERT INTO historico_edicoes (historico_id, dados_antes, dados_depois, justificativa, alterado_por, data_alteracao)
            VALUES (?, ?, ?, ?, ?, ?)`,
      [id, dadosAntes, dadosDepois, justificativa, alterado_por, dataAlt],
      (err3)=>{
        if (err3) console.error('Falha ao gravar auditoria:', err3);
      });

    // Atualiza registro principal
    const sql = `
      UPDATE historico
      SET vendedor = ?,
          marca_casco = ?, tamanho_casco = ?, qtd_casco = ?,
          tipo_caixa = ?, qtd_caixa = ?,
          data_emprestimo = ?, data_devolucao = ?,
          alterado_por = ?, justificativa_alteracao = ?, data_alteracao = ?
      WHERE id = ?
    `;
    db.run(sql, [
      vendedor||null,
      marca_casco, tamanho_casco, newQtdCasco,
      tipo_caixa, newQtdCaixa,
      dataEmp, dataDev,
      alterado_por, justificativa, dataAlt,
      id
    ], function(err2){
      if (err2) return res.status(500).json({error:'Erro ao atualizar registro.'});
      res.json({message:'Registro atualizado com sucesso'});
    });
  });
});

// Apagar registro
app.delete('/api/historico/:id', (req,res)=>{
  const { id } = req.params;
  const { justificativa } = req.body;
  if (!justificativa) return res.status(400).json({error:'A justificativa é obrigatória.'});

  db.get('SELECT * FROM historico WHERE id=?',[id],(err,reg)=>{
    if (err || !reg) return res.status(404).json({error:'Registo não encontrado'});

    const pendC = (reg.qtd_casco||0)-(reg.qtd_casco_devolvido||0);
    const pendX = (reg.qtd_caixa||0)-(reg.qtd_caixa_devolvido||0);

    if (pendC>0) atualizarEstoque(getItemDeEstoqueId('casco', reg.marca_casco), pendC);
    if (pendX>0) atualizarEstoque(getItemDeEstoqueId('caixa', reg.tipo_caixa), pendX);

    const dadosOriginais = JSON.stringify(reg);
    const dataApagado = nowSqlRecife();
    db.run('INSERT INTO registros_apagados (dados_originais, justificativa, data_apagado) VALUES (?,?,?)',
      [dadosOriginais, justificativa, dataApagado], (err2)=>{
        if (err2) return res.status(500).json({error:'Erro ao arquivar o registo apagado.'});
        db.run('DELETE FROM historico WHERE id=?',[id],(err3)=>{
          if (err3) return res.status(500).json({error:'Erro ao apagar o registo original.'});
          res.json({message:'Registo apagado e arquivado com sucesso.'});
        });
      });
  });
});

// Registros apagados
app.get('/api/registros-apagados', (req,res)=>{
  db.all('SELECT * FROM registros_apagados ORDER BY id DESC', [], (err,rows)=>{
    if (err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});

// Estoque
app.get('/api/estoque', (req,res)=>{
  db.all('SELECT * FROM estoque',[],(err,rows)=>{
    if (err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});
app.post('/api/estoque/:id', (req,res)=>{
  const { id } = req.params;
  const { quantidade } = req.body;
  db.run('UPDATE estoque SET quantidade=? WHERE id=?',[quantidade,id],function(err){
    if (err) return res.status(500).json({error:err.message});
    res.json({message:'Estoque atualizado com sucesso'});
  });
});

// Notificações (vencidos/hoje)
app.get('/api/notificacoes', (req,res)=>{
  const agora = nowSqlRecife();
  const sql=`
    SELECT h.*, c.nome AS cliente_nome
    FROM historico h JOIN clientes c ON h.cliente_id=c.id
    WHERE h.data_devolucao IS NOT NULL
      AND ( (COALESCE(h.qtd_casco,0) - COALESCE(h.qtd_casco_devolvido,0)) > 0
            OR (COALESCE(h.qtd_caixa,0) - COALESCE(h.qtd_caixa_devolvido,0)) > 0 )
      AND datetime(h.data_devolucao) <= datetime(?)
    ORDER BY datetime(h.data_devolucao) ASC
  `;
  db.all(sql,[agora],(err,rows)=>{
    if (err) return res.status(500).json({error:err.message});
    const out=rows.map(r=>{
      const m=(r.data_devolucao||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
      let dias=0;
      if (m){
        const [ , y, mo, d ] = m;
        const due = new Date(`${y}-${mo}-${d}T00:00:00`);
        const today=new Date();
        dias = Math.max(0, Math.floor((today-due)/86400000));
      }
      return {...r, dias_atraso:dias};
    });
    res.json(out);
  });
});

/* ===================== START ===================== */
app.listen(port, ()=>{
  console.log(`Servidor a funcionar na porta ${port}`);

  const initialUser='junior', initialPass='garcia2017';
  db.get('SELECT * FROM usuarios WHERE nome=?',[initialUser], (err,row)=>{
    if (!row){
      bcrypt.hash(initialPass, 10, (err2,hash)=>{
        if (err2) return console.error('Erro ao gerar hash',err2);
        db.run('INSERT INTO usuarios (nome,senha) VALUES(?,?)',[initialUser,hash],(err3)=>{
          if (!err3) console.log(`Utilizador "${initialUser}" criado com sucesso.`);
        });
      });
    }
  });
});
