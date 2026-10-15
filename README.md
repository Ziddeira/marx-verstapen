# Max Verstappen · Oracle Red Bull Racing

Site conceitual com animação de frames controlada pelo scroll, em HTML, CSS e JavaScript puros (sem bibliotecas).

## Estrutura

```
marx verstapen/
├── index.html
├── styles.css
├── script.js
├── IMG_0454.JPG            ← foto "quatro dedos" (seção Quatro)
├── IMG_0455.JPG            ← foto de costas (seção Piloto)
└── frameia-sequencia/      ← a pasta de frames fica AQUI, ao lado do index.html
    ├── frame-0001.webp
    ├── ...
    └── frame-0200.webp
```

A pasta `frameia-sequencia/` precisa ficar no mesmo nível do `index.html`. Para usar outro nome ou local, mude `CONFIG.path` no começo do `script.js`.

## Como rodar

O canvas carrega imagens via JavaScript, então abra o site por um servidor local (não pelo `file://`):

```bash
npx serve .
```

Ou use a extensão Live Server do VS Code. No GitHub Pages funciona direto.

## Como a animação funciona

- **Canvas responsivo**: ocupa a tela inteira, no modo *cover*, preservando a proporção horizontal do vídeo (828×462) e sem bordas. Respeita o `devicePixelRatio` (limitado a 2).
- **Pré-carregamento progressivo**: primeiro baixa frames espaçados (de 16 em 16) e libera a página; o restante carrega em segundo plano. Enquanto isso, o canvas desenha o frame mais próximo já carregado.
- **Suavidade**: o frame atual persegue o frame-alvo do scroll com interpolação, e dois frames vizinhos são mesclados para não haver degraus.
- **Capítulos**: `CONFIG.keyframes` liga o progresso do scroll aos frames, para cada texto aparecer na cena certa.
- **Frames 1 e 2** têm barra preta e outro enquadramento, então a sequência começa no frame 3 (`CONFIG.first`).
- **Selo "F1 REPLAY"** gravado nos frames é coberto em tempo real por um clone da área vizinha.
- **`prefers-reduced-motion`**: sem interpolação nem animações; cada capítulo mostra um quadro fixo, e só esses quadros são baixados.

## Desempenho

Os arquivos `.webp` desta pasta são, na verdade, PNGs com extensão `.webp` (cerca de 500 KB cada, 99 MB no total). Convertê-los para WebP de verdade reduziria o total para algo em torno de 10 MB, sem precisar mudar nenhum código.

---

Projeto conceitual de fã, sem afiliação com Max Verstappen, Red Bull Racing ou Formula 1.
