require('dotenv').config();
const express = require('express');
const cors = require('cors');
const paydunya = require('paydunya');
const crypto = require('crypto');

const app = express();

// ====================================================================
// 0. FONCTION D'ASSAINISSEMENT DES VARIABLES D'ENVIRONNEMENT
// ====================================================================
// Supprime les caractères non-ASCII (espaces insécables, guillemets parasites, retours chariot)
const cleanEnv = (val) => (val || '').replace(/[^\x20-\x7E]/g, '').trim();

// ====================================================================
// 1. MIDDLEWARES & PARSING
// ====================================================================
app.use(cors());

// PayDunya envoie des callbacks au format application/x-www-form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route de santé / Health check
app.get('/', (req, res) => {
    res.status(200).json({ success: true, message: "L'API de paiement Ika-Book est en ligne et opérationnelle !" });
});

// ====================================================================
// 2. CONFIGURATION PAYDUNYA
// ====================================================================
const setup = new paydunya.Setup({
    masterKey: cleanEnv(process.env.PAYDUNYA_MASTER_KEY),
    privateKey: cleanEnv(process.env.PAYDUNYA_PRIVATE_KEY),
    publicKey: cleanEnv(process.env.PAYDUNYA_PUBLIC_KEY),
    token: cleanEnv(process.env.PAYDUNYA_TOKEN),
    mode: cleanEnv(process.env.PAYDUNYA_MODE) || 'test'
});

const store = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Bibliothèque Virtuelle & Assistant IA Polyvalent",
    postalAddress: "Mali Bamako Rue 80, Porte 144",
    phoneNumber: "223 92837606",
    websiteURL: "https://ika-book.com",
    logoURL: "https://ika-book.com/Lt/1/logo.JPG",
    callbackURL: "https://api.ika-book.com/webhook"
});

// Helper pour instancier et configurer une facture PayDunya (PAR)
function buildInvoice(montantInt, description, userId, metadata, type) {
    const invoice = new paydunya.CheckoutInvoice(setup, store);
    invoice.addItem(description, 1, montantInt, montantInt, description);
    invoice.totalAmount = montantInt;
    
    // Ajout des données personnalisées récupérables lors de l'IPN/Webhook
    if (userId) invoice.addCustomData("userId", userId);
    if (metadata) invoice.addCustomData("metadata", metadata);
    invoice.addCustomData("type", type);

    // Redirections navigateur pour l'utilisateur final
    invoice.returnURL = "https://ika-book.com/paiement-reussi";
    invoice.cancelURL = "https://ika-book.com/paiement-annule";

    return invoice;
}

// Fonction générique de création de facture PayDunya
async function handleCreateInvoice(req, res, defaultDesc, type) {
    try {
        const { montant, description, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);

        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: `Montant invalide reçu: ${montant}` });
        }

        const invoice = buildInvoice(montantInt, description || defaultDesc, userId, metadata, type);
        const status = await invoice.create();

        // Résolution robuste de l'URL de redirection (PayDunya place parfois l'URL dans responseText)
        const redirectUrl = invoice.url || (invoice.responseText && invoice.responseText.startsWith('http') ? invoice.responseText : null);

        if (status && redirectUrl) {
            return res.status(200).json({ 
                success: true, 
                invoice_url: redirectUrl, 
                token: invoice.token 
            });
        } else {
            console.error(`Détails échec PayDunya [${type}]:`, {
                status: status,
                responseText: invoice.responseText,
                responseCode: invoice.responseCode,
                token: invoice.token,
                mode: cleanEnv(process.env.PAYDUNYA_MODE)
            });

            return res.status(400).json({ 
                success: false, 
                message: `Erreur PayDunya (${invoice.responseText || 'Échec création'}). Vérifiez le mode test/live des clés.`,
                code: invoice.responseCode 
            });
        }
    } catch (error) {
        console.error(`Erreur critique /creer-paiement [${type}]:`, error.message || error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ====================================================================
// 3. ROUTES DE CRÉATION DE PAIEMENT (PAR)
// ====================================================================

// --- 3.1 ACHAT DE CRÉDITS ---
app.post('/creer-paiement', (req, res) => handleCreateInvoice(req, res, "Achat de crédits Ika-Book", "credit"));

// --- 3.2 ACHAT DE PDF ---
app.post('/creer-paiement-pdf', (req, res) => handleCreateInvoice(req, res, "Achat PDF Ika-Book", "pdf"));

// --- 3.3 PAIEMENT PUSH (AMBASSADEUR) ---
app.post('/creer-paiement-push', (req, res) => handleCreateInvoice(req, res, "Paiement Push Ambassadeur", "push"));

// ====================================================================
// 4. WEBHOOK / IPN CENTRALISÉ
// ====================================================================
app.post('/webhook', async (req, res) => {
    try {
        // PayDunya transmet les données sous le nœud "data"
        const payloadData = req.body.data;
        if (!payloadData) return res.status(400).send("Aucune donnée reçue");

        const { status, hash, invoice, custom_data, receipt_url } = payloadData;
        
        // Vérification de la signature SHA-512 de la MasterKey
        const masterKeyHash = crypto
            .createHash('sha512')
            .update(cleanEnv(process.env.PAYDUNYA_MASTER_KEY))
            .digest('hex');

        if (hash !== masterKeyHash) {
            console.warn("Webhook rejeté : Signature hash invalide.");
            return res.status(403).send("Signature invalide");
        }

        if (status === "completed" || status === "success") {
            const transactionMetadata = custom_data ? custom_data.metadata : null;
            const transactionType = custom_data ? custom_data.type : 'credit'; 
            
            if (transactionMetadata) {
                let workerUrl = "";

                if (transactionType === "pdf") {
                    workerUrl = "https://pont-pdf.ladjitraore5995.workers.dev/s2s/pdf";
                } else if (transactionType === "push") {
                    workerUrl = "https://ikacredit.ladjitraore5995.workers.dev/s2s/ambassadeur";
                } else {
                    workerUrl = "https://mobilemoney.ladjitraore5995.workers.dev/s2s/deliver";
                }

                try {
                    const s2sResponse = await fetch(workerUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-server-key": cleanEnv(process.env.S2S_SECRET_KEY)
                        },
                        body: JSON.stringify({
                            token: invoice ? invoice.token : payloadData.token,
                            metadata: transactionMetadata,
                            invoice_url: receipt_url || ""
                        })
                    });

                    if (!s2sResponse.ok) {
                        console.error(`Erreur livraison Worker [${transactionType}]:`, await s2sResponse.text());
                    } else {
                        console.log(`Livraison transmise au Worker [${transactionType}] avec succès.`);
                    }
                } catch (fetchError) {
                    console.error(`Échec communication Worker [${transactionType}]:`, fetchError.message);
                }
            }
        }
        
        return res.status(200).send("Notification IPN traitée avec succès");

    } catch (error) {
        console.error("Erreur critique Webhook:", error);
        return res.status(500).send("Erreur interne du serveur");
    }
});

// ====================================================================
// 5. VÉRIFICATION DU STATUT DE PAIEMENT
// ====================================================================
app.get('/statut-paiement/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const invoice = new paydunya.CheckoutInvoice(setup, store);
        
        const isConfirmed = await invoice.confirm(token); 
        
        if (isConfirmed) {
            return res.status(200).json({ 
                success: invoice.status === 'completed', 
                status: invoice.status, 
                customer: invoice.customer || null,
                receipt_url: invoice.receiptURL || null 
            }); 
        } else {
            return res.status(404).json({ success: false, status: 'unknown' });
        }
    } catch (e) {
        return res.status(500).json({ success: false, status: 'unknown', error: e.message });
    }
});

// ====================================================================
// 6. VIREMENTS AUTOMATIQUES (PER / Payouts DirectPay)
// ====================================================================
app.post('/s2s/payout-authors', async (req, res) => {
    try {
        if (req.headers['x-server-key'] !== cleanEnv(process.env.S2S_SECRET_KEY)) {
            return res.status(401).json({ success: false, error: "Non autorisé" });
        }

        const { payouts } = req.body;

        if (!payouts || !Array.isArray(payouts)) {
            return res.status(400).json({ success: false, error: "Format des virements invalide" });
        }

        const directPay = new paydunya.DirectPay(setup);
        const resultats = [];

        for (const author of payouts) {
            try {
                console.log(`Transfert PER de ${author.amount} FCFA vers ${author.phone}`);
                const response = await directPay.creditAccount(author.phone, author.amount);
                resultats.push({ phone: author.phone, status: 'success', details: response });
            } catch (err) {
                console.error(`Échec transfert PER (${author.phone}):`, err.message || err);
                resultats.push({ phone: author.phone, status: 'failed', error: err.message || err });
            }
        }

        return res.status(200).json({ 
            success: true, 
            message: "Campagne de virements PER terminée.",
            details: resultats 
        });

    } catch (error) {
        console.error("Erreur /s2s/payout-authors:", error);
        return res.status(500).json({ success: false, error: "Erreur serveur interne" });
    }
});

// ====================================================================
// 7. DÉMARRAGE DU SERVEUR
// ====================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur Express PayDunya prêt et en écoute sur le port ${PORT}`));
