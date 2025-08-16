import UploadDropzone from "@/components/UploadDropzone";

export default function Home() {
  return (
    <div className="min-h-screen w-full px-4 py-10 sm:px-6 md:px-10">
      <main className="mx-auto flex max-w-3xl flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Screenshot Redactor</h1>
          <p className="mt-2 text-sm text-muted-foreground">Privacy-first redaction, entirely in your browser.</p>
        </div>
        <UploadDropzone />
        <div className="text-xs text-muted-foreground text-center">
          <p>No server upload. We store your image in-memory/session only.</p>
          <p className="mt-1">Paste with Cmd/Ctrl+V or drop a file. Supported: PNG, JPG.</p>
        </div>
      </main>
    </div>
  );
}
