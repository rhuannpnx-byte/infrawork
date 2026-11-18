# Prévia das páginas de um PDF em PNG, para revisão visual: python previa.py arquivo.pdf pasta [p1,p2,...]
import os
import sys
import pypdfium2 as pdfium

arquivo, pasta = sys.argv[1], sys.argv[2]
os.makedirs(pasta, exist_ok=True)
doc = pdfium.PdfDocument(arquivo)
paginas = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else range(1, len(doc) + 1)
for n in paginas:
    if 1 <= n <= len(doc):
        doc[n - 1].render(scale=1.1).to_pil().save(f'{pasta}/p{n:03d}.png')
print(len(doc))
