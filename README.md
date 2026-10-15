# Max Verstappen · Oracle Red Bull Racing

Site conceitual com animação de frames em 4K controlada pelo scroll, em HTML, CSS e JavaScript puros (sem bibliotecas).

## Estrutura

```
marx verstapen/
├── index.html
├── styles.css
├── script.js
├── IMG_0454.JPG                 ← foto "quatro dedos" (seção Quatro)
├── IMG_0455.JPG                 ← foto de costas (seção Piloto)
└── frameia-sequencia/           ← a pasta de frames fica AQUI, ao lado do index.html
    ├── 4k/    frame-0001.webp … frame-0199.webp   (3832×2126)
    ├── 1080/  frame-0001.webp … frame-0199.webp   (1920×1065)
    └── 720/   frame-0001.webp … frame-0199.webp   (1280×710)
```

A pasta `frameia-sequencia/` precisa ficar no mesmo nível do `index.html`, com as três subpastas. Para usar outro nome ou local, mude `CONFIG.path` no começo do `script.js`.

## Como rodar

O canvas carrega imagens via JavaScript, então abra o site por um servidor local (não pelo `file://`):

```bash
npx serve .
```

Ou use a extensão Live Server do VS Code. No GitHub Pages funciona direto.

Para testar uma resolução específica, adicione `?q=4k`, `?q=1080` ou `?q=720` à URL.

## Como a animação funciona

- **Quadros 4K**: extraídos do vídeo 4K original (3840×2142, 60 fps), um a cada dois quadros (199 no total). As faixas pretas de 5 px em cima e embaixo foram cortadas e o selo "F1 REPLAY" foi removido nos próprios arquivos.
- **Resolução certa para cada tela**: o script mede quantos pixels reais o quadro ocupa (tamanho da tela × `devicePixelRatio`) e escolhe 720p, 1080p ou 4K. Celulares vão no máximo até 1080p, e o modo "economia de dados" usa 720p.
- **Carregamento em camadas**: os quadros 720p (leves) abrem a página rápido e servem de base. A camada nítida (1080p ou 4K) vem em seguida e fica guardada compactada.
- **Memória sob controle**: 199 quadros 4K decodificados ocupariam cerca de 6,5 GB. Por isso só uma janela de quadros ao redor da posição atual é decodificada em 4K (`CONFIG.decodeWindow`), e o resto é liberado. Ao rolar rápido, o movimento disfarça a base; ao parar, a imagem fica em 4K.
- **Canvas responsivo**: ocupa a tela inteira no modo *cover*, preservando a proporção horizontal do vídeo, sem bordas.
- **Suavidade**: o frame atual persegue o frame-alvo do scroll com interpolação, e dois quadros vizinhos são mesclados para não haver degraus.
- **Capítulos**: `CONFIG.keyframes` liga o progresso do scroll aos quadros, para cada texto aparecer na cena certa.
- **`prefers-reduced-motion`**: sem interpolação nem animações. Cada capítulo mostra um quadro fixo, e só esses quadros são baixados.

## Peso

| Pasta | Por quadro | Total |
| --- | --- | --- |
| `4k` | ~160 KB | ~32 MB |
| `1080` | ~80 KB | ~16 MB |
| `720` | ~50 KB | ~10 MB |

Cada visitante baixa a camada 720p e mais uma (1080p ou 4K), nunca as três.

---

Projeto conceitual de fã, sem afiliação com Max Verstappen, Red Bull Racing ou Formula 1.
