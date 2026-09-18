import MainLayout from '../components/layout/MainLayout'

export default function LoginPage() {
  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:3000/api/v1/auth/google';
  };
  return (
    <MainLayout>
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <h1 className="text-2xl font-bold text-white">Login</h1>
        <div>Všechna vaše data jsou chráněna.</div>
        <button
          className="flex items-center gap-2 bg-white text-black px-6 py-2 rounded shadow hover:bg-gray-100 transition"
          onClick={handleGoogleLogin}
        >
          <img src="/img/ico-google.webp" alt="Google" className="h-5 w-5" />
          Přihlásit se přes Google
        </button>
      </div>
    </MainLayout>
  );
}
