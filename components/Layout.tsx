interface LayoutProps {
  title: string;
  subtitle: string;
  children: any;
}

export default function Layout({ title, subtitle, children }: LayoutProps) {
  return (
    <div class="container">
      <div class="header">
        <h1 safe>{title}</h1>
        <p safe>{subtitle}</p>
      </div>

      <div class="content">{children}</div>
    </div>
  );
}
