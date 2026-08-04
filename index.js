const express = require('express');
const cors = require('cors');
const paydunya = require('paydunya');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    postalAddress: "Mali Bamako Rue 80, Porte 144", // CORRIGÉ : 'postalAddress' au lieu de 'Address'
    phoneNumber: "223 92837606",
    websiteUrl: "https://ika-book.com", // CORRIGÉ : 'websiteUrl' au lieu de 'websiteURL'
    logoUrl: "https://ika-book.com/Lt/1/logo.JPG", // CORRIGÉ : 'logoUrl' au lieu de 'logoURL'
    callbackUrl: "https://api.ika-book.com/webhook" // CORRIGÉ : 'callbackUrl' au lieu de 'callbackURL'
});

const transactions = {}; 

app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;

        // Sécurité : On s'assure que le montant est un entier valide
        const montantInt = parseInt(montant, 10);
        if (isNaN(montantInt) || montantInt <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem(description || "Achat chez Ika-Book", 1, montantInt, montantInt);
        invoice.totalAmount = montantInt;
        invoice.returnUrl = 'https://ika-book.com'; 
        invoice.cancelUrl = 'https://ika-book.com';
        await invoice.create();

        if (invoice.url) {
            transactions[invoice.token] = {
                status: 'pending',
                userId: userId,
                metadata: metadata 
            };

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

        const { status, hash, invoice } = data;
        
        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
            .digest('hex');

        if (hash === masterKeyHash) {
            const currentTransaction = transactions[invoice.token];

            if (currentTransaction) {
                if (status === "completed" && currentTransaction.status !== 'completed') {
                    currentTransaction.status = 'completed';
                    
                    try {
                        const s2sResponse = await fetch("https://mobilemoney.ladjitraore5995.workers.dev/s2s/deliver", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "x-server-key": process.env.S2S_SECRET_KEY 
                            },
                            body: JSON.stringify({
                                metadata: currentTransaction.metadata
                            })
                        });

                        const s2sResult = await s2sResponse.json();
                        if(!s2sResponse.ok) {
                            console.error("Erreur critique lors de la livraison Worker :", s2sResult);
                        }
                    } catch (fetchError) {
                        console.error("Échec de la communication avec le Worker Cloudflare :", fetchError);
                    }
                    
                } else if (status === "cancelled") {
                    currentTransaction.status = 'cancelled';
                }
            }
            res.status(200).send("Notification traitée");
        } else {
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        res.status(500).send("Erreur interne du serveur");
    }
});

app.get('/statut-paiement/:token', (req, res) => {
    const token = req.params.token;
    const transaction = transactions[token];
    
    if (transaction) {
        res.status(200).json({ success: true, status: transaction.status });
    } else {
        res.status(404).json({ success: false, status: 'unknown' });
    }
});

const PORT = process.env.PORT || 3000;

// ==========================================
// ROUTES API PUSH (DEBOURSEMENT PAYDUNYA)
// ==========================================

app.post('/initier-push', async (req, res) => {
    try {
        const { account_alias, amount, withdraw_mode, debit_account_number } = req.body;

        // Validation basique : le montant ne doit pas être une valeur décimale
        if (amount % 1 !== 0) {
            return res.status(400).json({ success: false, message: "Le montant ne doit pas être une valeur décimale." });
        }

        // Configuration des en-têtes requis pour l'API Push PayDunya
        const headers = {
            "Content-Type": "application/json",
            "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY,
            "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY,
            "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN
        };

        // ---------------------------------------------------------
        // ÉTAPE 1 : INITIATION DU DEBOURSEMENT (get-invoice)
        // ---------------------------------------------------------
        const payloadInitiation = {
            account_alias: account_alias,
            amount: amount,
            withdraw_mode: withdraw_mode,
            callback_url: "https://api.ika-book.com/webhook-push" // L'URL doit être valide, sans quoi la transaction ne sera pas autorisée
        };

        // Ajout du paramètre optionnel uniquement si le mode est paydunya
        if (withdraw_mode === "paydunya" && debit_account_number) {
            payloadInitiation.debit_account_number = debit_account_number;
        }

        const responseInitiation = await fetch("https://app.paydunya.com/api/v2/disburse/get-invoice", {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payloadInitiation)
        });

        const dataInitiation = await responseInitiation.json();

        // Si la réponse est différente de "00", on arrête et on renvoie l'erreur
        if (dataInitiation.response_code !== "00") {
            return res.status(400).json({ success: false, message: "Échec de l'initiation", details: dataInitiation });
        }

        const disburse_token = dataInitiation.disburse_token; // Statut intermédiaire "Created" à ce stade

        // ---------------------------------------------------------
        // ÉTAPE 2 : SOUMISSION DU DEBOURSEMENT (submit-invoice)
        // ---------------------------------------------------------
        const payloadSoumission = {
            disburse_invoice: disburse_token,
            disburse_id: "PUSH-" + Date.now() // Numéro de référence de transaction facultatif
        };

        const responseSoumission = await fetch("https://app.paydunya.com/api/v2/disburse/submit-invoice", {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payloadSoumission)
        });

        const dataSoumission = await responseSoumission.json();

        // Retourner la réponse finale au client
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

        // Le hash renvoyé par PayDunya est vérifié avec l'algorithme SHA-512 de la MasterKey
        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
            .digest('hex');

        if (hash === masterKeyHash) {
            console.log(`[WEBHOOK PUSH] Déboursement ${token} - Statut final: ${status} - Montant: ${amount}`);
            
            // Logique de traitement selon les statuts finaux possibles : success ou failed (ou pending si en cours)
            if (status === "success") {
                // La transaction a abouti
                // TODO: Mettre à jour la base de données pour confirmer le déboursement
            } else if (status === "failed") {
                // La transaction n'a pas abouti
                // TODO: Mettre à jour la base de données et informer le client
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
        // --- BLOC DE SÉCURITÉ AJOUTÉ ---
        const serverKey = req.headers['x-server-key'];
        if (serverKey !== process.env.S2S_SECRET_KEY) {
            return res.status(403).json({ success: false, message: "Accès refusé. Clé serveur invalide." });
        }
        // ------------------------------

        const { compteDestinataire, montant } = req.body;

        // Arrondir le montant pour éviter que PayDunya ne rejette les montants avec virgule (ex: 839.58)
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

app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));
