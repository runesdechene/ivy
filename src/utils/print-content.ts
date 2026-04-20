import type { ShopifyOrder } from '@/types/shopify';

interface PrintContentProps {
  order: ShopifyOrder;
}

export function generatePrintContent({ order }: PrintContentProps): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Bordereau ${order.name}</title>
        <style>
          @page {
            size: A4;
            margin: 20mm;
          }
          body {
            font-family: Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
            padding: 40px;
            max-width: 210mm;
            margin: 0 auto;
            color: #2b3440;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
          }
          .item {
            margin-bottom: 20px;
            padding: 10px;
            border: 1px solid rgba(43, 52, 64, 0.10);
            page-break-inside: avoid;
          }
          .variants {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 10px;
          }
          .variant {
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .logo {
            width: 200px;
            margin-bottom: 20px;
            object-fit: contain;
          }
          .footer {
            margin-top: 40px;
            text-align: justify;
            font-size: 12px;
            color: #556070;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="print-content">
          <img src="/images/runesdechene-invoice.png" alt="Runes de chêne" class="logo" />
          <div class="header">
            <h2>Bordereau de commande</h2>
            <div>N° ${order.name}</div>
          </div>
          <div>
            <p>Date: ${new Date(order.createdAt).toLocaleDateString('fr-FR')}</p>
          </div>
          <div>
            <h3>Articles</h3>
            ${order.lineItems?.map(item => {
              if (item.isCancelled) return '';
              
              const variants = Array.from({ length: item.quantity }).map(() => {
                const color = item.variantTitle?.split(' / ')[0] || '';
                const size = item.variantTitle?.split(' / ')[1] || '';
                return { color, size };
              });

              return `
                <div class="item">
                  <div><strong>${item.title}</strong></div>
                  <div class="variants">
                    ${variants.map(variant => `
                      <div class="variant">
                        <span>${variant.color} / ${variant.size}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('') || ''}
          </div>
          <div class="footer">
            <p>
            Cette commande fut imprimée en flux tendu, ce qui explique son délai plus long.
            Cette méthode nous permet de garantir un large choix de couleurs, de tailles et de motif, tout en réduisant à néant
            le gachis textile et le sur-stockage. Nous savons qu'à l'heure des livraisons immédiates, ce type de 
            commande peut être parfois mal perçu, mais nous le trouvons plus humain et plus écologique. Nous vous remercions donc pour votre patience et votre confiance. 🎉
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}
