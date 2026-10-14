require('dotenv').config();
const express = require('express');
const cors = require('cors');
const paydunya = require('paydunya');
const crypto = require('crypto');

const app = express();

// ====================================================================
// 1. MIDDLEWARES
// ====================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route de test & Health check
app.get('/', (req, res) => {
    res.status(200).json({ message: "L'API de paiement Ika-Book est en ligne et fonctionnelle !" });
});

// ====================================================================
// 2. CONFIGURATION PAYDUNYA (AVEC NETTOYAGE TRIM)
// ====================================================================
const setup = new paydunya.Setup({
    masterKey: (process.env.PAYDUNYA_MASTER_KEY || '').trim(),
    privateKey: (process.env.PAYDUNYA_PRIVATE_KEY || '').trim(),
    publicKey: (process.env.PAYDUNYA_PUBLIC_KEY || '').trim(),
    token: (process.env.PAYDUNYA_TOKEN || '').trim(),
    mode: (process.env.PAYDUNYA_MODE || 'test').trim()
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

// Helper pour instancier et configurer une facture PayDunya
function buildInvoice(montantInt, description, userId, metadata, type) {
    const invoice = new paydunya.CheckoutInvoice(setup, store);
    invoice.addItem(description, 1, montantInt, montantInt);
    invoice.totalAmount = montantInt;
    
    // Données personnalisées transmises lors du callback IPN
    if (userId) invoice.addCustomData("userId", userId);
    if (metadata) invoice.addCustomData("metadata", metadata);
    invoice.addCustomData("type", type);

    // URLs de redirection navigateur après action du client
    invoice.returnURL = "https://ika-book.com/paiement-reussi";
    invoice.cancelURL = "https://ika-book.com/paiement-annule";

    return invoice;
}

// ====================================================================
// 3. ROUTES DE CRÉATION DE PAIEMENT (PAR)
// ====================================================================

// --- 3.1 ACHAT DE CRÉDITS ---
app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);

        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: `Montant invalide reçu: ${montant}` });
        }

        const invoice = buildInvoice(montantInt, description || "Achat de crédits chez Ika-Book", userId, metadata, "credit");
        const status = await invoice.create();

        if (status && invoice.url) {
            return res.status(200).json({ success: true, invoice_url: invoice.url, token: invoice.token });
        } else {
            return res.status(400).json({ success: false, message: invoice.responseText || "Erreur de création de facture PayDunya" });
        }
    } catch (error) {
        console.error("Erreur /creer-paiement:", error.message || error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// --- 3.2 ACHAT DE PDF ---
app.post('/creer-paiement-pdf', async (req, res) => {
    try {
        const { montant, description, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);

        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        const invoice = buildInvoice(montantInt, description || "Achat PDF chez Ika-Book", userId, metadata, "pdf");
        const status = await invoice.create();

        if (status && invoice.url) {
            return res.status(200).json({ success: true, invoice_url: invoice.url, token: invoice.token });
        } else {
            return res.status(400).json({ success: false, message: invoice.responseText || "Erreur de création de facture" });
        }
    } catch (error) {
        console.error("Erreur /creer-paiement-pdf:", error.message || error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// --- 3.3 PAIEMENT PUSH (AMBASSADEUR) ---
app.post('/creer-paiement-push', async (req, res) => {
    try {
        const { montant, description, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);

        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        const invoice = buildInvoice(montantInt, description || "Paiement Push chez Ika-Book", userId, metadata, "push");
        const status = await invoice.create();

        if (status && invoice.url) {
            return res.status(200).json({ success: true, invoice_url: invoice.url, token: invoice.token });
        } else {
            return res.status(400).json({ success: false, message: invoice.responseText || "Erreur de création de facture" });
        }
    } catch (error) {
        console.error("Erreur /creer-paiement-push:", error.message || error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ====================================================================
// 4. WEBHOOK CENTRALISÉ (IPN)
// ====================================================================
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body.data;
        if (!data) return res.status(400).send("Aucune donnée reçue");

        const { status, hash, invoice, custom_data } = data;
        
        // Validation du Hash SHA-512 avec la Master Key
        const masterKeyHash = crypto
            .createHash('sha512')
            .update((process.env.PAYDUNYA_MASTER_KEY || '').trim())
            .digest('hex');

        if (hash !== masterKeyHash) {
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
                            "x-server-key": process.env.S2S_SECRET_KEY 
                        },
                        body: JSON.stringify({
                            token: invoice ? invoice.token : null,
                            metadata: transactionMetadata,
                            invoice_url: data.receipt_url || ""
                        })
                    });

                    if (!s2sResponse.ok) {
                        console.error(`Erreur Worker [${transactionType}]:`, await s2sResponse.text());
                    } else {
                        console.log(`Livraison réussie pour le Worker [${transactionType}]`);
                    }
                } catch (fetchError) {
                    console.error(`Échec communication Worker [${transactionType}]:`, fetchError);
                }
            }
        }
        
        return res.status(200).send("Notification traitée");

    } catch (error) {
        console.error("Erreur Webhook:", error);
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
        const status = await invoice.confirm(token); 
        
        if (status) {
            return res.status(200).json({ 
                success: true, 
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
// 6. VIREMENTS AUTOMATIQUES (PER / Payouts)
// ====================================================================
app.post('/s2s/payout-authors', async (req, res) => {
    try {
        if (req.headers['x-server-key'] !== process.env.S2S_SECRET_KEY) {
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
                console.log(`Transfert de ${author.amount} FCFA vers ${author.phone}`);
                const response = await directPay.creditAccount(author.phone, author.amount);
                resultats.push({ phone: author.phone, status: 'success', details: response });
            } catch (err) {
                console.error(`Échec du transfert vers ${author.phone}:`, err.message || err);
                resultats.push({ phone: author.phone, status: 'failed', error: err.message || err });
            }
        }

        return res.status(200).json({ 
            success: true, 
            message: "Traitement de la campagne de virements terminé.",
            details: resultats 
        });

    } catch (error) {
        console.error("Erreur route payout-authors:", error);
        return res.status(500).json({ success: false, error: "Erreur serveur interne" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));
