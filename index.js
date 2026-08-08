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

// ====================================================================
// 2. CONFIGURATION PAYDUNYA
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
    callbackUrl: "https://api.ika-book.com/webhook"
});

// ====================================================================
// 3. ROUTES DE PAIEMENT (ACHAT DE CRÉDITS)
// ====================================================================

app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;

        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem(description || "Achat chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;
        
        // 1. UTILISER LES CUSTOM DATA POUR SAUVEGARDER LE METADATA CHEZ PAYDUNYA
        invoice.addCustomData("userId", userId);
        invoice.addCustomData("metadata", metadata);

        await invoice.create();

        if (invoice.url) {
            // 2. AJOUTER LE TOKEN DANS L'URL DE RETOUR
            invoice.returnUrl = `https://ika-book.com/paiement-reussi?token=${invoice.token}`; 
            invoice.cancelUrl = `https://ika-book.com/paiement-annule?token=${invoice.token}`;
            
            res.status(200).json({
                success: true,
                invoice_url: invoice.url,
                token: invoice.token,
                message: "Facture générée"
            });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText || "Erreur" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const data = req.body.data;
        if (!data) return res.status(400).send("Aucune donnée reçue");

        const { status, hash, invoice, custom_data } = data; // 3. RECUPERER LES CUSTOM_DATA
        
        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
            .digest('hex');

        if (hash === masterKeyHash) {
            
            // Si le paiement est réussi
            if (status === "completed" || status === "success") {
                try {
                    // On récupère le metadata stocké chez Paydunya
                    const transactionMetadata = custom_data ? custom_data.metadata : null;

                    if (transactionMetadata) {
                        const s2sResponse = await fetch("https://mobilemoney.ladjitraore5995.workers.dev/s2s/deliver", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-server-key": process.env.S2S_SECRET_KEY_IA 
                            },
                            body: JSON.stringify({
                                metadata: transactionMetadata
                            })
                        });

                        if(!s2sResponse.ok) {
                            console.error("Erreur critique lors de la livraison Worker IA :", await s2sResponse.text());
                        }
                    }
                } catch (fetchError) {
                    console.error("Échec de la communication avec le Worker Cloudflare IA :", fetchError);
                }
            }
            res.status(200).send("Notification traitée");
        } else {
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        console.error("Erreur Webhook:", error);
        res.status(500).send("Erreur interne du serveur");
    }
});

// 4. INTERROGER PAYDUNYA DIRECTEMENT AU LIEU DE LA MÉMOIRE LOCALE
app.get('/statut-paiement/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const invoice = new paydunya.CheckoutInvoice(setup, store);
        
        // La méthode confirm() interroge les serveurs de Paydunya pour le statut en temps réel
        const status = await invoice.confirm(token); 
        
        if (status) {
            res.status(200).json({ success: true, status: invoice.status }); // 'completed', 'pending', 'cancelled'
        } else {
            res.status(404).json({ success: false, status: 'unknown' });
        }
    } catch (e) {
        res.status(500).json({ success: false, status: 'unknown', error: e.message });
    }
});


// ==========================================
// ROUTES API PUSH (DEBOURSEMENT PAYDUNYA)
// ==========================================

app.post('/initier-push', async (req, res) => {
    try {
        const { account_alias, amount, withdraw_mode, debit_account_number } = req.body;

        if (amount % 1 !== 0) {
            return res.status(400).json({ success: false, message: "Le montant ne doit pas être une valeur décimale." });
        }

        const headers = {
            "Content-Type": "application/json",
            "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY,
            "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY,
            "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN
        };

        const payloadInitiation = {
            account_alias: account_alias,
            amount: amount,
            withdraw_mode: withdraw_mode,
            callback_url: "https://api.ika-book.com/webhook-push" 
        };

        if (withdraw_mode === "paydunya" && debit_account_number) {
            payloadInitiation.debit_account_number = debit_account_number;
        }

        const responseInitiation = await fetch("https://app.paydunya.com/api/v2/disburse/get-invoice", {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payloadInitiation)
        });

        const dataInitiation = await responseInitiation.json();

        if (dataInitiation.response_code !== "00") {
            return res.status(400).json({ success: false, message: "Échec de l'initiation", details: dataInitiation });
        }

        const disburse_token = dataInitiation.disburse_token; 

        const payloadSoumission = {
            disburse_invoice: disburse_token,
            disburse_id: "PUSH-" + Date.now() 
        };

        const responseSoumission = await fetch("https://app.paydunya.com/api/v2/disburse/submit-invoice", {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payloadSoumission)
        });

        const dataSoumission = await responseSoumission.json();

        res.status(200).json({
            success: true,
            message: "Requête de déboursement traitée",
            data: dataSoumission
        });

    } catch (error) {
        console.error("Erreur API PUSH:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ==========================================
// WEBHOOK SPECIFIQUE AU PUSH
// ==========================================

app.post('/webhook-push', (req, res) => {
    try {
        const data = req.body;
        if (!data) return res.status(400).send("Aucune donnée reçue");

        const { hash, status, token, amount, withdraw_mode, transaction_id, disburse_id } = data;

        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
            .digest('hex');

        if (hash === masterKeyHash) {
            console.log(`[WEBHOOK PUSH] Déboursement ${token} - Statut final: ${status} - Montant: ${amount}`);
            
            if (status === "success") {
                // TODO: Mettre à jour la base de données
            } else if (status === "failed") {
                // TODO: Mettre à jour la base de données
            }

            res.status(200).send("Notification de déboursement traitée");
        } else {
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        console.error("Erreur webhook push:", error);
        res.status(500).send("Erreur interne du serveur");
    }
});

// ==========================================
// ROUTE PER (PAIEMENT ET REDISTRIBUTION)
// ==========================================

app.post('/transfert-per', async (req, res) => {
    try {
        const serverKey = req.headers['x-server-key'];
        
        // --- UTILISATION DE LA CLÉ PDF ICI ---
        if (serverKey !== process.env.S2S_SECRET_KEY_PDF) {
            return res.status(403).json({ success: false, message: "Accès refusé. Clé serveur invalide." });
        }
        // -------------------------------------

        const { compteDestinataire, montant } = req.body;

        const montantArrondi = Math.round(Number(montant));

        if (!compteDestinataire || !montantArrondi || montantArrondi <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Le compte destinataire et un montant valide sont requis." 
            });
        }

        const directPay = new paydunya.DirectPay(setup);
        await directPay.creditAccount(compteDestinataire, montantArrondi);

        res.status(200).json({
            success: true,
            description: directPay.description,
            responseText: directPay.responseText,
            transactionID: directPay.transactionID
        });

    } catch (error) {
        console.error("Erreur lors du transfert PER:", error);
        res.status(500).json({ 
            success: false, 
            message: "Échec du transfert.",
            error: error.message || error 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));
