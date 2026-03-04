declare module '@sendgrid/mail' {
  interface MailDataRequired {
    to: string | string[];
    from: string;
    subject?: string;
    text?: string;
    html?: string;
    cc?: string | string[];
    bcc?: string | string[];
    headers?: Record<string, string>;
  }

  interface SendGridMail {
    setApiKey(apiKey: string): void;
    send(data: MailDataRequired | MailDataRequired[]): Promise<any>;
  }

  const mail: SendGridMail;
  export default mail;
}

