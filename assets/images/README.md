# RT Express Logo Assets

## Logo Requirements for Invoice PDF

To display the RT Express logo in invoice PDFs, place your logo file in this directory with one of the following names:

### Supported Logo Files (in order of preference):
1. `rt-express-logo.png` (recommended)
2. `logo.png`
3. `rt-express-logo.jpg`
4. `logo.jpg`

### Logo Specifications:
- **Format**: PNG (preferred) or JPG
- **Recommended Size**: 300x120 pixels (2.5:1 aspect ratio)
- **Maximum Size**: 600x240 pixels
- **Background**: Transparent (for PNG) or white (for JPG)
- **Quality**: High resolution for professional appearance

### Logo Placement:
- Position: Top-left corner of invoice
- Display Size: 150x60 pixels (automatically scaled)
- Alignment: Left-aligned with company information

### Fallback Behavior:
If no logo file is found, the system will display "RT EXPRESS" as text with the company tagline "Real Time Express Logistics" below it.

### Testing:
After adding your logo file:
1. Generate a test invoice PDF
2. Verify the logo appears correctly
3. Check that the logo is properly sized and positioned
4. Ensure the logo quality is acceptable for professional invoices

### Troubleshooting:
- Check file permissions (logo file should be readable)
- Verify file format is supported (PNG/JPG only)
- Check file size (very large files may cause performance issues)
- Review server logs for any error messages related to logo loading
