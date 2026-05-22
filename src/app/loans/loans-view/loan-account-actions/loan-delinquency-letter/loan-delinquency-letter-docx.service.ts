/**
 * Copyright since 2025 Mifos Initiative
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Injectable } from '@angular/core';
import {
  DelinquencyLetterData,
  DelinquencyLetterParagraph,
  DelinquencyLetterType
} from './loan-delinquency-letter.model';

interface ZipFileEntry {
  name: string;
  content: string | Uint8Array;
}

@Injectable({
  providedIn: 'root'
})
export class LoanDelinquencyLetterDocxService {
  readonly letterheadImagePath = 'assets/images/warm-springs-tribal-credit-letterhead.png';
  readonly letterheadContactLine =
    'P.O. Box 1187 ~ 1236 Scouts Dr. - Warm Springs, OR 97761    Phone: (541) 553-3201 ~ Fax: (541) 553-3515';

  private readonly docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  private readonly zipMimeType = 'application/zip';
  private readonly bodyFontName = 'Times New Roman';
  private readonly bodyFontSize = 22;
  private readonly headerRelationshipId = 'rIdHeader';
  private readonly letterheadImageRelationshipId = 'rIdLetterhead';
  private readonly letterheadImageWidthEmu = 1524000;
  private readonly letterheadImageHeightEmu = 1019175;
  private readonly paragraphLineSpacing = 276;
  private readonly noticeHighlightFill = 'FFF2CC';
  private readonly textEncoder = new TextEncoder();
  private readonly crcTable = this.createCrcTable();
  private letterheadImagePromise: Promise<Uint8Array | null> | null = null;

  async createDocx(data: DelinquencyLetterData): Promise<Blob> {
    const paragraphs = this.buildLetterParagraphs(data);
    const letterheadImage = await this.getLetterheadImage();
    const hasLetterhead = letterheadImage !== null;
    const now = new Date();
    const files: ZipFileEntry[] = [
      {
        name: '[Content_Types].xml',
        content: this.buildContentTypesXml(hasLetterhead)
      },
      {
        name: '_rels/.rels',
        content: this.buildPackageRelationshipsXml()
      },
      {
        name: 'docProps/core.xml',
        content: this.buildCorePropertiesXml(now)
      },
      {
        name: 'docProps/app.xml',
        content: this.buildAppPropertiesXml()
      },
      {
        name: 'word/_rels/document.xml.rels',
        content: this.buildDocumentRelationshipsXml(hasLetterhead)
      },
      {
        name: 'word/styles.xml',
        content: this.buildStylesXml()
      },
      {
        name: 'word/document.xml',
        content: this.buildDocumentXml(paragraphs, hasLetterhead)
      }
    ];

    if (letterheadImage) {
      files.push(
        {
          name: 'word/header1.xml',
          content: this.buildHeaderXml()
        },
        {
          name: 'word/_rels/header1.xml.rels',
          content: this.buildHeaderRelationshipsXml()
        },
        {
          name: 'word/media/letterhead.png',
          content: letterheadImage
        }
      );
    }

    return this.createStoredZip(files);
  }

  async createLettersZip(data: DelinquencyLetterData, letterTypes: DelinquencyLetterType[]): Promise<Blob> {
    const letterFiles = await Promise.all(
      letterTypes.map(async (letterType: DelinquencyLetterType) => {
        const letterData: DelinquencyLetterData = {
          ...data,
          letterType
        };
        const documentBlob = await this.createDocx(letterData);
        return {
          name: this.buildFileName(letterData),
          content: new Uint8Array(await documentBlob.arrayBuffer())
        };
      })
    );

    return this.createStoredZip(letterFiles, this.zipMimeType);
  }

  buildPreviewLines(data: DelinquencyLetterData): string[] {
    return this.buildLetterParagraphs(data).map((paragraph: DelinquencyLetterParagraph) => paragraph.text);
  }

  buildPreviewParagraphs(data: DelinquencyLetterData): DelinquencyLetterParagraph[] {
    return this.buildLetterParagraphs(data);
  }

  buildFileName(data: DelinquencyLetterData): string {
    const letterName = this.getLetterName(data.letterType).replace(/\s+/g, '-').toLowerCase();
    const loanNumber = this.sanitizeFileName(data.loanNumber || 'loan');
    return `${letterName}-${loanNumber}.docx`;
  }

  buildZipFileName(data: DelinquencyLetterData): string {
    const loanNumber = this.sanitizeFileName(data.loanNumber || 'loan');
    return `delinquency-letters-${loanNumber}.zip`;
  }

  buildLetterParagraphs(data: DelinquencyLetterData): DelinquencyLetterParagraph[] {
    const paragraphs: DelinquencyLetterParagraph[] = [];
    const dateStyle = data.letterType === 'collections' ? 'long' : 'numeric';
    const greetingName = data.greetingName || this.extractGreetingName(data.recipientName);
    const loanNumber = data.loanNumber || '';
    const loanFileNumber = data.loanFileNumber || loanNumber;

    paragraphs.push({ text: this.formatDate(data.letterDate, dateStyle), spacingAfter: 320 });
    this.addRecipientBlock(paragraphs, data);
    paragraphs.push({ text: '' });

    if (data.letterType === 'collections' || data.letterType === 'maturity') {
      paragraphs.push({
        text: 'DEFAULT NOTICE',
        alignment: 'center',
        bold: true,
        spacingAfter: 240
      });
    }

    if (data.letterType === 'final') {
      paragraphs.push({ text: 'RE:\tLoan Past Maturity Notice', spacingAfter: 80 });
      paragraphs.push({ text: `Loan:\t${loanNumber}`, spacingAfter: 240 });
    }

    paragraphs.push({ text: `${greetingName},`, spacingAfter: 240 });
    this.addLetterBody(paragraphs, data);
    this.addClosing(paragraphs, data, loanFileNumber);
    return paragraphs;
  }

  private addRecipientBlock(paragraphs: DelinquencyLetterParagraph[], data: DelinquencyLetterData): void {
    const addressLines = data.mailingAddress
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);

    if (data.recipientName) {
      paragraphs.push({ text: data.recipientName, spacingAfter: 0 });
    }

    addressLines.forEach((line: string, index: number) => {
      paragraphs.push({ text: line, spacingAfter: index === addressLines.length - 1 ? 240 : 0 });
    });
  }

  private addLetterBody(paragraphs: DelinquencyLetterParagraph[], data: DelinquencyLetterData): void {
    switch (data.letterType) {
      case 'oneTwentyDay':
        this.addOneTwentyDayLetter(paragraphs, data);
        break;
      case 'collections':
        this.addCollectionsLetter(paragraphs, data);
        break;
      case 'maturity':
        this.addMaturityLetter(paragraphs, data);
        break;
      case 'final':
        this.addFinalLetter(paragraphs, data);
        break;
    }
  }

  private addOneTwentyDayLetter(paragraphs: DelinquencyLetterParagraph[], data: DelinquencyLetterData): void {
    paragraphs.push({
      text:
        `Our records show your loan is in default status, being more than 120 days past due on loan #${data.loanNumber}, ` +
        `in the amount of +/- ${this.formatMoney(data.pastDueAmount, data.currencyCode)}. Your principal balance is ` +
        `${this.formatMoney(data.principalBalance, data.currencyCode)} and your payoff is ` +
        `${this.formatMoney(data.payoffAmount, data.currencyCode)}.${this.getLifeInsuranceNotice(data)}`,
      spacingAfter: 240
    });
    paragraphs.push({
      text:
        'Tribal Credit has the option of declaring the entire balance of your loan to be due immediately and to file ' +
        'a court action to collect this debt. It is important you contact our office to discuss your options.',
      spacingAfter: 320
    });
  }

  private addCollectionsLetter(paragraphs: DelinquencyLetterParagraph[], data: DelinquencyLetterData): void {
    paragraphs.push({
      text:
        'You are at risk of losing your home if you do not take action immediately. Our records show your loan is in ' +
        `default status, being more than 120 days past due on loan #${data.loanNumber}, in the amount of +/- ` +
        `${this.formatMoney(data.pastDueAmount, data.currencyCode)}. Your principal balance is ` +
        `${this.formatMoney(data.principalBalance, data.currencyCode)} and your payoff is ` +
        `${this.formatMoney(data.payoffAmount, data.currencyCode)}.${this.getLifeInsuranceNotice(data)}`,
      spacingAfter: 240
    });
    this.addOptions(paragraphs);
    paragraphs.push({
      text:
        'If you do not resolve this matter within 30 days, Credit will file a civil complaint against you with Tribal ' +
        `Court to foreclose on your home. Please contact our office ${data.phoneNumber}.`,
      spacingAfter: 320
    });
  }

  private addMaturityLetter(paragraphs: DelinquencyLetterParagraph[], data: DelinquencyLetterData): void {
    paragraphs.push({ text: 'Credit has received NO COMMUNICATION from you!', spacingAfter: 240 });
    paragraphs.push({
      text:
        'You are at risk of losing your home if you do not take action immediately. According to our records your home ' +
        `loan ${data.loanNumber} matured on ${this.formatDate(data.maturityDate, 'long')} and is due in full +/- ` +
        `${this.formatMoney(data.payoffAmount, data.currencyCode)}. A loan that remains unpaid past the maturity date ` +
        'is considered in Default under the terms of the loan documents and may put your collateral at risk for repossession.',
      spacingAfter: 240
    });
    this.addOptions(paragraphs);
    paragraphs.push({
      text:
        'If you do not resolve this situation within 30 days we will file a civil complaint against you with Tribal ' +
        'Court to foreclose on your home. Please contact our office to discuss all options.',
      spacingAfter: 320
    });
  }

  private addFinalLetter(paragraphs: DelinquencyLetterParagraph[], data: DelinquencyLetterData): void {
    paragraphs.push({
      text:
        'You are at risk of losing your home if you do not take action immediately. According to our records your loan ' +
        `#${data.loanNumber} matured on ${this.formatDate(data.maturityDate, 'long')} and is due and payable in full ` +
        `+/- ${this.formatMoney(data.payoffAmount, data.currencyCode)}. A loan that remains unpaid past the maturity ` +
        'date is considered in Default under the terms of the loan documents and may put your collateral at risk.',
      spacingAfter: 240
    });
    this.addOptions(paragraphs);
    paragraphs.push({
      text:
        'If you do not resolve this matter or we do not hear from you within 30 days ' +
        `(${this.formatDate(data.deadlineDate, 'long')}), Credit will file a Civil Complaint to foreclose on the home. ` +
        `Please contact our office ${data.phoneNumber}.`,
      spacingAfter: 320
    });
  }

  private addOptions(paragraphs: DelinquencyLetterParagraph[]): void {
    paragraphs.push({ text: 'Here are your options, in our order of preference:', spacingAfter: 160 });
    paragraphs.push({ text: '1. Pay the past due amount shown above.', spacingAfter: 80 });
    paragraphs.push({
      text: '2. Negotiate an agreement to bring your loan out of delinquency, within policy.',
      spacingAfter: 80
    });
    paragraphs.push({ text: '3. Voluntarily surrender home back to Credit.', spacingAfter: 80 });
    paragraphs.push({ text: '4. Credit will file a Civil Complaint to foreclose on the home.', spacingAfter: 240 });
  }

  private addClosing(
    paragraphs: DelinquencyLetterParagraph[],
    data: DelinquencyLetterData,
    loanFileNumber: string
  ): void {
    paragraphs.push({ text: 'Sincerely,', spacingAfter: 320 });
    paragraphs.push({ text: data.officerName, spacingAfter: 0 });
    paragraphs.push({ text: data.officerTitle, spacingAfter: 240 });
    paragraphs.push({ text: `CC: Loan File #${loanFileNumber}`, spacingAfter: 320 });
    paragraphs.push({ text: '- NOTICE -', alignment: 'center', bold: true, highlight: true, spacingAfter: 0 });
    paragraphs.push({
      text:
        'This letter is an attempt to collect debt. Any and all results forthwith may be used in a Court of law in the ' +
        'event this debt needs to be litigated in the future.',
      alignment: 'center',
      highlight: true,
      spacingAfter: 160
    });
  }

  private getLifeInsuranceNotice(data: DelinquencyLetterData): string {
    return data.includeLifeInsuranceNotice
      ? ' The life insurance on the loan is no longer in force because it is more than 12 months past due.'
      : '';
  }

  private formatDate(value: Date | null, style: 'numeric' | 'long'): string {
    if (!value) {
      return '';
    }
    const options: Intl.DateTimeFormatOptions =
      style === 'long'
        ? {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          }
        : {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric'
          };
    return new Intl.DateTimeFormat('en-US', options).format(value);
  }

  private formatMoney(value: number, currencyCode: string): string {
    const amount = Number.isFinite(value) ? value : 0;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (error) {
      return amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  }

  private extractGreetingName(recipientName: string): string {
    return recipientName.trim().split(/\s+/)[0] || recipientName;
  }

  private getLetterName(letterType: string): string {
    switch (letterType) {
      case 'oneTwentyDay':
        return '120 Day Letter';
      case 'maturity':
        return 'Maturity Letter';
      case 'final':
        return 'Final Letter';
      default:
        return 'Collections Letter';
    }
  }

  private sanitizeFileName(value: string): string {
    return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'loan';
  }

  private async getLetterheadImage(): Promise<Uint8Array | null> {
    if (!this.letterheadImagePromise) {
      this.letterheadImagePromise = this.loadLetterheadImage();
    }
    return this.letterheadImagePromise;
  }

  private async loadLetterheadImage(): Promise<Uint8Array | null> {
    try {
      const response = await fetch(this.letterheadImagePath);
      if (!response.ok) {
        return null;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  private buildDocumentXml(paragraphs: DelinquencyLetterParagraph[], includeLetterhead: boolean): string {
    const topMargin = includeLetterhead ? 2520 : 1440;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs.map((paragraph: DelinquencyLetterParagraph) => this.renderParagraph(paragraph)).join('\n')}
    <w:sectPr>
      ${includeLetterhead ? `<w:headerReference w:type="default" r:id="${this.headerRelationshipId}"/>` : ''}
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="${topMargin}" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
  }

  private renderParagraph(paragraph: DelinquencyLetterParagraph): string {
    const spacingAfter = paragraph.spacingAfter ?? 120;
    const justification = paragraph.alignment ? `<w:jc w:val="${paragraph.alignment}"/>` : '';
    const shading = paragraph.highlight
      ? `<w:shd w:val="clear" w:color="auto" w:fill="${this.noticeHighlightFill}"/>`
      : '';
    const runProperties = this.renderRunProperties(paragraph);
    const text = paragraph.text ? this.renderText(paragraph.text) : '';
    return `<w:p><w:pPr><w:spacing w:after="${spacingAfter}" w:line="${this.paragraphLineSpacing}" w:lineRule="auto"/>${justification}${shading}</w:pPr><w:r>${runProperties}${text}</w:r></w:p>`;
  }

  private renderRunProperties(paragraph: DelinquencyLetterParagraph): string {
    const properties = [
      paragraph.bold ? '<w:b/>' : '',
      paragraph.highlight ? '<w:highlight w:val="yellow"/>' : ''
    ].join('');
    return properties ? `<w:rPr>${properties}</w:rPr>` : '';
  }

  private renderText(text: string): string {
    return text
      .split('\t')
      .map((part: string, index: number) => {
        const tab = index > 0 ? '<w:tab/>' : '';
        return `${tab}<w:t xml:space="preserve">${this.escapeXml(part)}</w:t>`;
      })
      .join('');
  }

  private buildHeaderXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  ${this.renderLetterheadImageParagraph()}
  <w:p>
    <w:pPr>
      <w:spacing w:after="0" w:line="240" w:lineRule="auto"/>
      <w:jc w:val="center"/>
      <w:ind w:left="-720" w:right="-720"/>
      <w:pBdr>
        <w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/>
      </w:pBdr>
    </w:pPr>
    <w:r>
      <w:rPr>
        <w:rFonts w:ascii="Agency FB" w:hAnsi="Agency FB" w:cs="Agency FB"/>
        <w:sz w:val="18"/>
        <w:szCs w:val="18"/>
      </w:rPr>
      <w:t xml:space="preserve">${this.escapeXml(this.letterheadContactLine)}</w:t>
    </w:r>
  </w:p>
</w:hdr>`;
  }

  private renderLetterheadImageParagraph(): string {
    return `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${this.letterheadImageWidthEmu}" cy="${this.letterheadImageHeightEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Warm Springs Tribal Credit Enterprise Letterhead"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="letterhead.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${this.letterheadImageRelationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${this.letterheadImageWidthEmu}" cy="${this.letterheadImageHeightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  private buildContentTypesXml(includeLetterhead: boolean): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${includeLetterhead ? '<Default Extension="png" ContentType="image/png"/>' : ''}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  ${includeLetterhead ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  }

  private buildPackageRelationshipsXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  }

  private buildDocumentRelationshipsXml(includeLetterhead: boolean): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${includeLetterhead ? `<Relationship Id="${this.headerRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` : ''}
</Relationships>`;
  }

  private buildHeaderRelationshipsXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="${this.letterheadImageRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/letterhead.png"/>
</Relationships>`;
  }

  private buildCorePropertiesXml(now: Date): string {
    const isoDate = now.toISOString();
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Delinquency Letter</dc:title>
  <dc:creator>Mifos X Web App</dc:creator>
  <cp:lastModifiedBy>Mifos X Web App</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:modified>
</cp:coreProperties>`;
  }

  private buildAppPropertiesXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Mifos X Web App</Application>
</Properties>`;
  }

  private buildStylesXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="${this.bodyFontName}" w:hAnsi="${this.bodyFontName}" w:cs="${this.bodyFontName}"/>
      <w:sz w:val="${this.bodyFontSize}"/>
      <w:szCs w:val="${this.bodyFontSize}"/>
    </w:rPr>
  </w:style>
</w:styles>`;
  }

  private createStoredZip(files: ZipFileEntry[], mimeType: string = this.docxMimeType): Blob {
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    files.forEach((file: ZipFileEntry) => {
      const nameBytes = this.textEncoder.encode(file.name);
      const contentBytes = typeof file.content === 'string' ? this.textEncoder.encode(file.content) : file.content;
      const crc = this.crc32(contentBytes);
      const dosDateTime = this.getDosDateTime(new Date());
      const localHeader = this.createLocalFileHeader(nameBytes, contentBytes, crc, dosDateTime);
      const centralHeader = this.createCentralDirectoryHeader(nameBytes, contentBytes, crc, dosDateTime, offset);

      localParts.push(localHeader, contentBytes);
      centralParts.push(centralHeader);
      offset += localHeader.length + contentBytes.length;
    });

    const centralDirectory = this.concat(centralParts);
    const endRecord = this.createEndOfCentralDirectory(files.length, centralDirectory.length, offset);
    const zipBytes = this.concat([
      ...localParts,
      centralDirectory,
      endRecord
    ]);
    const zipBuffer = new ArrayBuffer(zipBytes.byteLength);
    new Uint8Array(zipBuffer).set(zipBytes);
    return new Blob([zipBuffer], { type: mimeType });
  }

  private createLocalFileHeader(
    nameBytes: Uint8Array,
    contentBytes: Uint8Array,
    crc: number,
    dosDateTime: { date: number; time: number }
  ): Uint8Array {
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dosDateTime.time, true);
    view.setUint16(12, dosDateTime.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, contentBytes.length, true);
    view.setUint32(22, contentBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    return header;
  }

  private createCentralDirectoryHeader(
    nameBytes: Uint8Array,
    contentBytes: Uint8Array,
    crc: number,
    dosDateTime: { date: number; time: number },
    localHeaderOffset: number
  ): Uint8Array {
    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, dosDateTime.time, true);
    view.setUint16(14, dosDateTime.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, contentBytes.length, true);
    view.setUint32(24, contentBytes.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, localHeaderOffset, true);
    header.set(nameBytes, 46);
    return header;
  }

  private createEndOfCentralDirectory(
    fileCount: number,
    centralDirectorySize: number,
    centralDirectoryOffset: number
  ): Uint8Array {
    const record = new Uint8Array(22);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, fileCount, true);
    view.setUint16(10, fileCount, true);
    view.setUint32(12, centralDirectorySize, true);
    view.setUint32(16, centralDirectoryOffset, true);
    view.setUint16(20, 0, true);
    return record;
  }

  private getDosDateTime(date: Date): { date: number; time: number } {
    const year = Math.max(date.getFullYear(), 1980);
    return {
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
    };
  }

  private createCrcTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  }

  private crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    bytes.forEach((byte: number) => {
      crc = (crc >>> 8) ^ this.crcTable[(crc ^ byte) & 0xff];
    });
    return (crc ^ 0xffffffff) >>> 0;
  }

  private concat(parts: Uint8Array[]): Uint8Array {
    const totalLength = parts.reduce((length: number, part: Uint8Array) => length + part.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    parts.forEach((part: Uint8Array) => {
      result.set(part, offset);
      offset += part.length;
    });
    return result;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
