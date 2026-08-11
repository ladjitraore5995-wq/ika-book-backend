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
// --- ACHAT DE PDF (Express App) ---
app.post('/creer-paiement-pdf', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;

        // Validation du montant
        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        // Validation basique des métadonnées requises
        if (!metadata || !metadata.docId || !userId) {
            return res.status(400).json({ 
                success: false, 
                message: "Métadonnées invalides ou incomplètes (docId ou userId manquant)" 
            });
        }

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        
        invoice.addItem(description || "Achat PDF chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;

        // Transmission standardisée à PayDunya
        invoice.addCustomData("userId", String(userId));
        invoice.addCustomData("docId", String(metadata.docId));
        invoice.addCustomData("type", "pdf");
        
        // Stockage sécurisé de l'objet metadata sous forme de chaîne JSON
        invoice.addCustomData("metadata", JSON.stringify(metadata));

        const created = await invoice.create();

        if (created && invoice.url) {
            invoice.returnUrl = `https://ika-book.com/paiement-reussi?token=${invoice.token}`; 
            invoice.cancelUrl = `https://ika-book.com/paiement-annule?token=${invoice.token}`;

            return res.status(200).json({ 
                success: true, 
                invoice_url: invoice.url, 
                token: invoice.token 
            });
        } else {
            return res.status(400).json({ 
                success: false, 
                message: invoice.responseText || "Échec de la création de la facture PayDunya" 
            });
        }
    } catch (error) {
        console.error("Erreur /creer-paiement-pdf:", error);
        return res.status(500).json({ success: false, error: error.message });
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
// FONCTION DE PUSH MOBILE MONEY (B2C DISPERSEMENT)
// ====================================================================
async function transfererArgentB2C(telephone, montant, operateur) {
    try {
        // 1. Déterminer le code opérateur PayDunya (Mali par défaut)
        let withdrawMode = "";
        const op = (operateur || "").toLowerCase();
        
        if (op.includes("orange")) withdrawMode = "orange-money-mali";
        else if (op.includes("moov")) withdrawMode = "moov-mali";
        else withdrawMode = operateur; // Si vous passez déjà le code exact

        console.log(`⏳ Préparation Push B2C : ${montant} FCFA vers ${telephone} via ${withdrawMode}`);

        const headers = {
            "Content-Type": "application/json",
            "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY,
            "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY,
            "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN
        };

        // Étape 1 : Obtenir le token de dispersement
        const resInvoice = await fetch("https://app.paydunya.com/api/v1/disburse/get-invoice", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                account_alias: telephone,
                amount: montant,
                withdraw_mode: withdrawMode
            })
        });

        const invoiceData = await resInvoice.json();
        if (invoiceData.response_code !== "00") {
            throw new Error(`Erreur Init B2C: ${invoiceData.response_text || 'Inconnue'}`);
        }

        // Étape 2 : Confirmer et déclencher l'envoi des fonds
        const resSubmit = await fetch("https://app.paydunya.com/api/v1/disburse/submit-invoice", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                disburse_invoice: invoiceData.disburse_token,
                disburse_id: `b2c_${Date.now()}` // ID unique de transaction
            })
        });

        const submitData = await resSubmit.json();
        
        if (submitData.response_code === "00") {
            console.log(`✅ Succès du Push B2C vers ${telephone} : ${submitData.response_text}`);
            return true;
        } else {
            throw new Error(`Erreur Validation B2C: ${submitData.response_text}`);
        }

    } catch (error) {
        console.error("❌ Échec du Push B2C :", error.message);
        return false;
    }
}

// ====================================================================
// 4. LE WEBHOOK CENTRALISÉ AVEC DISTRIBUTION (DIRECT PAY / B2C)
// ====================================================================

app.post('/webhook', async (req, res) => {
    try {
        const data = req.body.data;
        if (!data) return res.status(400).send("Aucune donnée reçue");

        const { status, hash, invoice, custom_data } = data;
        const masterKeyHash = crypto.createHash('sha512').update(process.env.PAYDUNYA_MASTER_KEY).digest('hex');

        if (hash !== masterKeyHash) return res.status(403).send("Signature invalide");

        if (status === "completed" || status === "success") {
            const transactionMetadata = custom_data ? custom_data.metadata : null;
            const transactionType = custom_data ? custom_data.type : 'credit'; 
            
            if (transactionMetadata) {
                let workerUrl = "";
                if (transactionType === "pdf") workerUrl = "https://pont-pdf.ladjitraore5995.workers.dev/s2s/pdf";
                else if (transactionType === "push") workerUrl = "https://ikacredit.ladjitraore5995.workers.dev/s2s/ambassadeur";
                else workerUrl = "https://mobilemoney.ladjitraore5995.workers.dev/s2s/deliver";

                try {
                    // 1. Notification du Worker S2S (Donner accès au client)
                    const s2sResponse = await fetch(workerUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-server-key": process.env.S2S_SECRET_KEY },
                        body: JSON.stringify({
                            token: invoice.token,
                            metadata: transactionMetadata,
                            invoice_url: invoice.receipt_url || ""
                        })
                    });

                    if(s2sResponse.ok) {
                        console.log(`Livraison réussie pour le Worker [${transactionType}]`);

                        // -----------------------------------------------------------------
                        // 2. DISTRIBUTION AUTOMATIQUE (B2C) MOBILE MONEY
                        // -----------------------------------------------------------------
                        
                        // Cas A : L'auteur vend un PDF
                        if (transactionType === "pdf" && transactionMetadata.partAuteur > 0) {
                            await transfererArgentB2C(
                                transactionMetadata.secretAuthorPhone,
                                transactionMetadata.partAuteur,
                                transactionMetadata.secretMobileMoneyOperator 
                            );
                        }
                        
                        // Cas B : Paiement généré par un Ambassadeur (Push)
                        else if (transactionType === "push" && transactionMetadata.partAmbassadeur > 0) {
                            await transfererArgentB2C(
                                transactionMetadata.ambassadeurPhone,
                                transactionMetadata.partAmbassadeur,
                                transactionMetadata.ambassadeurOperator 
                            );
                        }
                        // -----------------------------------------------------------------
                    } else {
                        console.error(`Erreur Worker [${transactionType}]:`, await s2sResponse.text());
                    }
                } catch (fetchError) {
                    console.error(`Échec communication Worker [${transactionType}]:`, fetchError);
                }
            }
        }
        
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
