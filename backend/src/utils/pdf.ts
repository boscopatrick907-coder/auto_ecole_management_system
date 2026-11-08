/** A small valid demo PDF. Actual teaching materials must be uploaded by the school. */
export function demoPdf(title: string): string {
 const safe=title.replace(/[^a-zA-Z0-9 \-_/]/g,'');
 const stream=`BT\n/F1 16 Tf\n50 770 Td\n(Auto-ecole La Marseillaise - DEMONSTRATION) Tj\n/F1 12 Tf\n0 -35 Td\n(${safe}) Tj\n0 -25 Td\n(Ce fichier de demonstration ne remplace pas un support de cours.) Tj\nET\n`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let pdf='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(pdf);
 pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return pdf;
}
