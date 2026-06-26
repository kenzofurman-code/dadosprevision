# Dados Prevision

Painel web em React + Vite para listar projetos sincronizados do Prevision a partir do Firestore.

## Rodar localmente

```bash
npm install
npm run dev
```

O arquivo `.env.local` ja esta configurado para desenvolvimento local com o projeto Firebase `dadosprevision`.

## Variaveis para o Vercel

No Vercel, crie o projeto apontando para este repositorio/pasta e configure estas variaveis em **Project Settings > Environment Variables**:

```env
VITE_FIREBASE_API_KEY=AIzaSyDkwakhAtKql_OQj66nZJZJypiiBBb1uVU
VITE_FIREBASE_AUTH_DOMAIN=dadosprevision.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=dadosprevision
VITE_FIREBASE_STORAGE_BUCKET=dadosprevision.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=15180779110
VITE_FIREBASE_APP_ID=1:15180779110:web:ebe0e6f7712b8046c027a7
VITE_FIREBASE_MEASUREMENT_ID=G-HS2BYYP62H
```

Config do build na Vercel:

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

## O que configurar no Firebase

1. Abra o projeto Firebase `dadosprevision`.
2. Ative o **Cloud Firestore** em modo nativo.
3. Crie a colecao `prevision_projetos`.
4. Cada documento deve ter estes campos, no minimo:

```json
{
  "id_prevision": "123",
  "nome_projeto": "Nome do projeto",
  "empresa_nome": "Empresa",
  "data_inicio": "2026-01-01",
  "data_fim": "2026-12-31",
  "status": "Ativo",
  "desativado": false
}
```

5. Publique regras de leitura. Para painel publico, use:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /prevision_projetos/{document} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

6. Em **Firestore > Indexes**, normalmente nao precisa criar indice manual para esta tela, porque a consulta usa apenas `orderBy("nome_projeto")`.
7. Em **Project Settings > General > Your apps**, confirme que o app Web existe e que as credenciais batem com as variaveis acima.
8. Em **Authentication > Settings > Authorized domains**, adicione o dominio gerado pela Vercel e qualquer dominio proprio que voce usar.

## Criar a colecao por script

Se o login da Firebase CLI falhar, use uma chave de Service Account:

1. No Firebase, abra **Project settings > Service accounts**.
2. Clique em **Generate new private key**.
3. Salve o arquivo JSON na raiz deste projeto com um nome como `service-account-dadosprevision.json`.
4. Rode:

```bash
npm run seed:firestore -- service-account-dadosprevision.json
```

Esse comando cria/atualiza o documento `prevision_projetos/exemplo-001`. Depois, voce pode apagar esse documento exemplo no console do Firestore quando a sincronizacao real estiver funcionando.

## Sincronizacao com Prevision

Para atualizar diariamente, crie uma Cloud Function agendada no Firebase que:

1. Leia o token/segredo da API Prevision via **Secret Manager** ou variaveis seguras.
2. Consulte os projetos na API do Prevision.
3. Grave/atualize os documentos em `prevision_projetos`.
4. Use `id_prevision` como ID do documento ou como campo unico para evitar duplicidade.

O front-end ja esta pronto para ler a colecao. A parte que depende de informacao externa e a Cloud Function, porque precisa do endpoint e da chave da API Prevision.
