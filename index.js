const express = require('express');
const cors = require('cors');
const paydunya = require('paydunya');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// ====================================================================
// 1. MIDDLEWARES
// ====================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.status(200).json({ message: "L'API de paiement Ika-Book est en ligne et fonctionnelle !" });
});

// ====================================================================
// 2. CONFIGURATION PAYDUNYA UNIQUE
// ====================================================================
const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test'
});

const store = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Bibliothèque Virtuelle & Assistant IA Polyvalent",
    postalAddress: "Mali Bamako Rue 80, Porte 144",
    phoneNumber: "223 92837606",
    websiteUrl: "https://ika-book.com",
    logoUrl: "https://ika-book.com/Lt/1/logo.JPG",
    callbackUrl: "https://api.ika-book.com/webhook" // URL UNIQUE pour tous les webhooks
});

// ====================================================================
// 3. ROUTES DE CRÉATION DE PAIEMENT
// ====================================================================

// --- 3.1 ACHAT DE CRÉDITS ---
app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) return res.status(400).json({ success: false, message: "Montant invalide" });

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem(description || "Achat chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;
        invoice.addCustomData("userId", userId);
        invoice.addCustomData("metadata", metadata);
        invoice.addCustomData("type", "credit");

        await invoice.create();

        if (invoice.url) {
            invoice.returnUrl = `https://ika-book.com/paiement-reussi?token=${invoice.token}`; 
            invoice.cancelUrl = `https://ika-book.com/paiement-annule?token=${invoice.token}`;
            res.status(200).json({ success: true, invoice_url: invoice.url, token: invoice.token });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText || "Erreur" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- 3.2 ACHAT DE PDF ---
app.post('/creer-paiement-pdf', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) return res.status(400).json({ success: false, message: "Montant invalide" });

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem(description || "Achat PDF chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;
        invoice.addCustomData("userId", userId);
        invoice.addCustomData("metadata", metadata);
        invoice.addCustomData("type", "pdf");

        await invoice.create();

        if (invoice.url) {
            invoice.returnUrl = `https://ika-book.com/paiement-reussi?token=${invoice.token}`; 
            invoice.cancelUrl = `https://ika-book.com/paiement-annule?token=${invoice.token}`;
            res.status(200).json({ success: true, invoice_url: invoice.url, token: invoice.token });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText || "Erreur" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- 3.3 PAIEMENT PUSH (AMBASSADEUR) ---
app.post('/creer-paiement-push', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;
        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) return res.status(400).json({ success: false, message: "Montant invalide" });

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem(description || "Paiement Push chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;
        invoice.addCustomData("userId", userId);
        invoice.addCustomData("metadata", metadata);
        invoice.addCustomData("type", "push");

        await invoice.create();

        if (invoice.url) {
            invoice.returnUrl = `https://ika-book.com/paiement-reussi?token=${invoice.token}`; 
            invoice.cancelUrl = `https://ika-book.com/paiement-annule?token=${invoice.token}`;
            res.status(200).json({ success: true, invoice_url: invoice.url, token: invoice.token });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText || "Erreur" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ====================================================================
// 4. LE WEBHOOK CENTRALISÉ AVEC DISTRIBUTION (DIRECT PAY)
// ====================================================================

app.post('/webhook', async (req, res) => {
    try {
        const data = req.body.data;
        if (!data) return res.status(400).send("Aucune donnée reçue");

        const { status, hash, invoice, custom_data } = data;
        
        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
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
                    // 1. On notifie le Worker Cloudflare pour donner le produit au client
                    const s2sResponse = await fetch(workerUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-server-key": process.env.S2S_SECRET_KEY 
                        },
                        body: JSON.stringify({
                            token: invoice.token,
                            metadata: transactionMetadata,
                            invoice_url: invoice.receipt_url || ""
                        })
                    });

                    if(!s2sResponse.ok) {
                        console.error(`Erreur critique Worker [${transactionType}]:`, await s2sResponse.text());
                    } else {
                        console.log(`Livraison réussie pour le Worker [${transactionType}]`);

                        // -----------------------------------------------------------------
                        // 2. DISTRIBUTION AUTOMATIQUE À L'AUTEUR (Seulement pour les PDF)
                        // -----------------------------------------------------------------
                        if (transactionType === "pdf" && transactionMetadata.partAuteur > 0 && transactionMetadata.secretAuthorPhone) {
                            try {
                                console.log(`Début du transfert de ${transactionMetadata.partAuteur} FCFA vers ${transactionMetadata.secretAuthorPhone}`);
                                
                                const directPay = new paydunya.DirectPay(setup);
                                const virementResult = await directPay.creditAccount(
                                    transactionMetadata.secretAuthorPhone,
                                    transactionMetadata.partAuteur
                                );

                                console.log("Succès du transfert vers l'auteur :", virementResult);
                            } catch (virementError) {
                                // On attrape l'erreur pour NE PAS planter le serveur Express
                                // Si le virement échoue (ex: solde insuffisant), le client garde son PDF
                                console.error("Échec du transfert vers l'auteur :", virementError.message || virementError);
                            }
                        }
                        // -----------------------------------------------------------------
                    }
                } catch (fetchError) {
                    console.error(`Échec communication Worker [${transactionType}]:`, fetchError);
                }
            }
        }
        
        // On répond toujours 200 à PayDunya pour clôturer le webhook
        res.status(200).send("Notification traitée");

    } catch (error) {
        console.error("Erreur Webhook:", error);
        res.status(500).send("Erreur interne du serveur");
    }
});

// ====================================================================
// 5. RÉCUPÉRATION DU STATUT
// ====================================================================
app.get('/statut-paiement/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const invoice = new paydunya.CheckoutInvoice(setup, store);
        const status = await invoice.confirm(token); 
        
        if (status) {
            res.status(200).json({ success: true, status: invoice.status, receipt_url: invoice.receiptUrl || invoice.receipt_url || null }); 
        } else {
            res.status(404).json({ success: false, status: 'unknown' });
        }
    } catch (e) {
        res.status(500).json({ success: false, status: 'unknown', error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));
