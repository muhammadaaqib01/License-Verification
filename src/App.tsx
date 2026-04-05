import * as React from 'react';
import { useState, useRef } from 'react';
import { Search, ShieldCheck, AlertCircle, User, CreditCard, Loader2, CheckCircle2, XCircle, Download, Printer, FileText, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { db, auth } from './firebase';

// ===============================================================
// Types
// ===============================================================

export interface License {
  licenseNumber: string;
  cnic: string;
  fileUrl: string;
  fileType: 'image' | 'pdf';
  uploadedAt?: any;
}

// ===============================================================
// Error Handling Spec for Firestore Operations
// ===============================================================

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ===============================================================
// Error Boundary Component
// ===============================================================

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        const parsedError = JSON.parse(this.state.error?.message || "");
        if (parsedError.error) {
          errorMessage = `Database Error: ${parsedError.error}`;
        }
      } catch {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-gray-600 mb-6">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-punjab-green text-white px-6 py-2 rounded-lg font-bold hover:bg-green-800 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function LicenseApp() {
  const [licenseNumber, setLicenseNumber] = useState('');
  const [cnic, setCnic] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<License | null | 'not_found'>(null);
  const [isStaticLoggedIn, setIsStaticLoggedIn] = useState(false);
  const [view, setView] = useState<'public' | 'admin'>('public');
  const cardRef = useRef<HTMLDivElement>(null);

  // Static Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(false);

  // Admin Form State
  const [adminForm, setAdminForm] = useState<Omit<License, 'uploadedAt'>>({
    licenseNumber: '',
    cnic: '',
    fileUrl: '',
    fileType: 'image'
  });
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);
    if (!file) return;

    // Check file size (Firestore 1MB limit, Base64 adds ~33% overhead)
    // We'll limit the file to 700KB to be safe
    if (file.size > 700 * 1024) {
      setFileError('File size too large. Please upload a file smaller than 700KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      const fileType = file.type.includes('pdf') ? 'pdf' : 'image';
      setAdminForm({
        ...adminForm,
        fileUrl: base64String,
        fileType: fileType as 'image' | 'pdf'
      });
    };
    reader.readAsDataURL(file);
  };

  const handleStaticLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      setIsStaticLoggedIn(true);
      setLoginError(false);
    } catch (error) {
      console.error('Login Error:', error);
      setLoginError(true);
    }
  };

  const handleStaticLogout = async () => {
    await signOut(auth);
    setIsStaticLoggedIn(false);
    setView('public');
    setLoginEmail('');
    setLoginPassword('');
  };

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u && u.email === 'abc@gmail.com') {
        setIsStaticLoggedIn(true);
      } else {
        setIsStaticLoggedIn(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleVerify = async () => {
    if (!licenseNumber.trim() || !cnic.trim()) return;

    setLoading(true);
    setResult(null);

    const path = 'licenses';
    try {
      const q = query(
        collection(db, path),
        where('licenseNumber', '==', licenseNumber.trim()),
        where('cnic', '==', cnic.trim())
      );
      
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const data = querySnapshot.docs[0].data() as License;
        setResult(data);
      } else {
        setResult('not_found');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    } finally {
      setLoading(false);
    }
  };

  const handleAddLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStaticLoggedIn) return;

    setUploading(true);
    setUploadSuccess(false);
    const path = 'licenses';

    try {
      await addDoc(collection(db, path), {
        ...adminForm,
        uploadedAt: serverTimestamp()
      });
      setUploadSuccess(true);
      setAdminForm({
        licenseNumber: '',
        cnic: '',
        fileUrl: '',
        fileType: 'image'
      });
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      setUploading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 print:bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 py-4 shadow-sm print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-punjab-green p-2 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-punjab-green leading-tight">Government of Punjab</h1>
              <p className="text-xs text-gray-500 font-medium tracking-wider uppercase">Excise, Taxation & Control</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setView(view === 'public' ? 'admin' : 'public')}
              className="text-sm font-bold text-punjab-green hover:underline"
            >
              {view === 'public' ? 'Admin Panel' : 'Verification Portal'}
            </button>
            {isStaticLoggedIn && (
              <button onClick={handleStaticLogout} className="text-xs text-red-600 font-bold hover:underline">Logout</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12 print:py-0 print:px-0">
        {view === 'admin' ? (
          !isStaticLoggedIn ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md mx-auto"
            >
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                <div className="p-8">
                  <div className="text-center mb-8">
                    <div className="bg-punjab-green/10 p-3 rounded-full inline-block mb-4">
                      <ShieldCheck className="w-8 h-8 text-punjab-green" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">Admin Login</h2>
                    <p className="text-sm text-gray-500">Enter your credentials to access the dashboard</p>
                  </div>

                  <form onSubmit={handleStaticLogin} className="space-y-6">
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-gray-700">Email Address</label>
                      <input
                        required
                        type="email"
                        className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-punjab-green outline-none"
                        placeholder="abc@gmail.com"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-gray-700">Password</label>
                      <input
                        required
                        type="password"
                        className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-punjab-green outline-none"
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                      />
                    </div>

                    {loginError && (
                      <p className="text-xs text-red-600 font-bold text-center">Invalid email or password</p>
                    )}

                    <button
                      type="submit"
                      className="w-full bg-punjab-green hover:bg-green-800 text-white font-bold py-4 rounded-xl shadow-lg transition-all"
                    >
                      Login to Dashboard
                    </button>
                  </form>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
            <div className="text-center">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Admin Dashboard</h2>
              <p className="text-gray-600">Upload and manage license records.</p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-8">
                <h3 className="text-xl font-bold mb-6 flex items-center space-x-2">
                  <FileText className="w-6 h-6 text-punjab-green" />
                  <span>Add New License Record</span>
                </h3>

                <form onSubmit={handleAddLicense} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-gray-700">License Number</label>
                      <input
                        required
                        type="text"
                        className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-punjab-green outline-none"
                        placeholder="xx-xx-xxxxx"
                        value={adminForm.licenseNumber}
                        onChange={(e) => setAdminForm({ ...adminForm, licenseNumber: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-gray-700">CNIC Number</label>
                      <input
                        required
                        type="text"
                        className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-punjab-green outline-none"
                        placeholder="xxxxx-xxxxxxx-x"
                        value={adminForm.cnic}
                        onChange={(e) => setAdminForm({ ...adminForm, cnic: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="block text-sm font-semibold text-gray-700">License Document (Image or PDF)</label>
                      <div className="relative">
                        <input
                          required
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          id="file-upload"
                          onChange={handleFileChange}
                        />
                        <label
                          htmlFor="file-upload"
                          className="flex items-center justify-center w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-2xl hover:border-punjab-green hover:bg-green-50 transition-all cursor-pointer group"
                        >
                          <div className="text-center">
                            <div className="bg-gray-100 p-3 rounded-full inline-block mb-2 group-hover:bg-green-100 transition-colors">
                              {adminForm.fileType === 'pdf' ? (
                                <FileText className="w-6 h-6 text-gray-500 group-hover:text-punjab-green" />
                              ) : (
                                <ImageIcon className="w-6 h-6 text-gray-500 group-hover:text-punjab-green" />
                              )}
                            </div>
                            <p className="text-sm font-medium text-gray-600">
                              {adminForm.fileUrl ? 'File selected (Click to change)' : 'Click to select license document'}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">PNG, JPG, or PDF (Max 700KB)</p>
                          </div>
                        </label>
                      </div>
                      {fileError && (
                        <p className="text-xs text-red-600 font-medium mt-1 flex items-center space-x-1">
                          <AlertCircle className="w-3 h-3" />
                          <span>{fileError}</span>
                        </p>
                      )}
                      {adminForm.fileUrl && !fileError && (
                        <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
                          <p className="text-xs font-bold text-gray-400 uppercase mb-2">Preview:</p>
                          {adminForm.fileType === 'image' ? (
                            <img src={adminForm.fileUrl} alt="Preview" className="h-32 w-auto rounded-lg shadow-sm" />
                          ) : (
                            <div className="flex items-center space-x-2 text-punjab-green font-semibold">
                              <FileText className="w-5 h-5" />
                              <span>PDF Document Selected</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={uploading || !!fileError || !adminForm.fileUrl}
                    className="w-full bg-punjab-green hover:bg-green-800 text-white font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5" />
                    )}
                    <span>{uploading ? 'Uploading...' : 'Save Record'}</span>
                  </button>

                  {uploadSuccess && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center text-green-600 font-bold"
                    >
                      Record saved successfully!
                    </motion.p>
                  )}
                </form>
              </div>
            </div>
          </motion.div>
        )) : (
          <>
            <div className="text-center mb-10 print:hidden">
              <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl mb-3">
                Driving License Verification
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Verify the authenticity of driving licenses issued by the Government of Punjab.
              </p>
            </div>

        {/* Search Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden mb-8 print:hidden">
          <div className="p-6 sm:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="space-y-2">
                <label htmlFor="license" className="block text-sm font-semibold text-gray-700">
                  License Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <CreditCard className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    id="license"
                    className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-punjab-green focus:border-punjab-green transition-all outline-none"
                    placeholder="xx-xx-xxxxx"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="cnic" className="block text-sm font-semibold text-gray-700">
                  CNIC Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    id="cnic"
                    className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-punjab-green focus:border-punjab-green transition-all outline-none"
                    placeholder="xxxxx-xxxxxxx-x"
                    value={cnic}
                    onChange={(e) => setCnic(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleVerify}
              disabled={loading || !licenseNumber.trim() || !cnic.trim()}
              className="w-full bg-punjab-green hover:bg-green-800 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  <span>Verify License</span>
                </>
              )}
            </button>
          </div>
          <div className="bg-punjab-light px-6 py-4 border-t border-green-100">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-punjab-green mt-0.5" />
              <p className="text-sm text-green-800">
                Please ensure the license number is entered exactly as printed on the card.
              </p>
            </div>
          </div>
        </div>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {result === 'not_found' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center print:hidden"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-red-900 mb-2">No License Found</h3>
              <p className="text-red-700">
                The license number you entered does not match any records in our database. Please check the number and try again.
              </p>
            </motion.div>
          )}

          {result && typeof result === 'object' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden print:shadow-none print:border-none"
              ref={cardRef}
            >
              <div className="bg-punjab-green p-6 text-white flex justify-between items-center">
                <div>
                  <h3 className="text-2xl font-bold">Verification Result</h3>
                  <p className="text-green-100 text-sm">Official Record Found</p>
                </div>
                <CheckCircle2 className="w-10 h-10 text-green-300" />
              </div>

              <div className="p-8">
                <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-6">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">License Number</p>
                    <p className="text-xl font-bold text-punjab-green">{result.licenseNumber}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">CNIC Number</p>
                    <p className="text-xl font-bold text-gray-900">{result.cnic}</p>
                  </div>
                  <div className="bg-green-100 text-green-800 px-4 py-1 rounded-full text-sm font-bold flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4" />
                    <span>VERIFIED</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-700 flex items-center space-x-2">
                      {result.fileType === 'pdf' ? <FileText className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                      <span>Official License Document:</span>
                    </p>
                    {result.uploadedAt && (
                      <p className="text-xs text-gray-400">Uploaded on: {new Date(result.uploadedAt).toLocaleDateString()}</p>
                    )}
                  </div>

                  <div className="border-4 border-gray-100 rounded-2xl overflow-hidden shadow-inner bg-gray-50 min-h-[300px] flex items-center justify-center">
                    {result.fileType === 'image' ? (
                      <img 
                        src={result.fileUrl} 
                        alt="License Document" 
                        className="w-full h-auto max-h-[800px] object-contain mx-auto"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      <div className="w-full h-[600px]">
                        <iframe 
                          src={`${result.fileUrl}#toolbar=0`} 
                          className="w-full h-full border-none"
                          title="License PDF"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 px-8 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-gray-500 border-t border-gray-100 print:hidden">
                <p>Verified on: {new Date().toLocaleString()}</p>
                <div className="flex space-x-4">
                  <button 
                    onClick={handlePrint}
                    className="flex items-center space-x-1 hover:text-punjab-green font-semibold transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Certificate</span>
                  </button>
                  <a 
                    href={result.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center space-x-1 hover:text-punjab-green font-semibold transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Original</span>
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    )}
  </main>

      {/* Footer */}
      <footer className="mt-auto py-8 border-t border-gray-200 bg-white print:hidden">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-gray-500 mb-2">
            © {new Date().getFullYear()} Government of Punjab. All rights reserved.
          </p>
          <div className="flex justify-center space-x-6 text-xs font-medium text-gray-400">
            <a href="#" className="hover:text-punjab-green transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-punjab-green transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-punjab-green transition-colors">Contact Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LicenseApp />
    </ErrorBoundary>
  );
}
