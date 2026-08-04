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
    Address: "Mali Bamako Rue 80, Porte 144", // ✅ Modifié : 'postalAddress' au lieu de 'Address'
    phoneNumber: "223 92837606",
    websiteURL: "https://ika-book.com",
    logoURL: "https://ika-book.com/Lt/1/logo.JPG",
    callbackURL: "https://api.ika-book.com/webhook" // URL pour l'IPN (invisible pour l'utilisateur)
});

const transactions = {}; 

app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, metadata } = req.body;

        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem(description || "Achat chez Ika-Book", 1, montant, montant);
        invoice.totalAmount = montant;
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
// --- NOUVELLE FONCTION DE PAIEMENT ET REDISTRIBUTION (SÉCURISÉE ET STRICTE) ---
async function payAndDistributeHandler(request, env) {
  try {
    // 1. Authentification
    const user = await verifyFirebaseToken(request);
    const body = await request.json();
    const docId = body.docId;

    if (!docId) {
      return badRequest(request, "docId manquant.");
    }

    // 2. Récupération des informations du document via D1
    const doc = await getDocument(env, docId);
    if (!doc) {
      return notFound(request, "Document introuvable.");
    }
    if (doc.type !== "payant") {
      return badRequest(request, "Ce document n'est pas payant.");
    }

    // --- Nettoyage du prix ---
    const rawPrice = doc.brutPrice || doc.price;
    const cleanPriceString = String(rawPrice).replace(/[^0-9]/g, '');
    const price = Number(cleanPriceString);

    if (isNaN(price) || price <= 0) {
      return badRequest(request, "Prix du document invalide.");
    }

    // 3. Calcul de la redistribution (42% Plateforme / 58% Auteur)
    // Utilisation de Math.round() pour éviter d'envoyer des nombres à virgule à PayDunya
    const partPlateforme = Math.round(price * 0.42);
    const partAuteur = Math.round(price * 0.58);
    
    const numeroPlateforme = "22374744773";

    // 4. Ordre de paiement / redistribution avec VÉRIFICATION STRICTE et SÉCURITÉ
    try {
      // --- Transfert Plateforme ---
      const repPlateforme = await fetch("https://api.ika-book.com/transfert-per", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-server-key": env.S2S_SECRET_KEY // Preuve d'identité du Worker
        },
        body: JSON.stringify({ compteDestinataire: numeroPlateforme, montant: partPlateforme })
      });
      
      const dataPlateforme = await repPlateforme.json();
      
      if (!repPlateforme.ok || dataPlateforme.success !== true) {
        console.error("Erreur transfert Plateforme:", dataPlateforme);
        return serverError(request, new Error("Échec du paiement vers la plateforme. Transaction annulée."));
      }

      // --- Transfert Auteur ---
      const repAuteur = await fetch("https://api.ika-book.com/transfert-per", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-server-key": env.S2S_SECRET_KEY // Preuve d'identité du Worker
        },
        body: JSON.stringify({ compteDestinataire: doc.secretAuthorPhone, montant: partAuteur })
      });
      
      const dataAuteur = await repAuteur.json();

      if (!repAuteur.ok || dataAuteur.success !== true) {
        console.error("Erreur transfert Auteur:", dataAuteur);
        return serverError(request, new Error("Échec de la redistribution à l'auteur. Transaction annulée."));
      }
      
    } catch (fetchErr) {
      console.error("Impossible de contacter l'API Ika-Book :", fetchErr);
      // On bloque l'accès car l'API Express est injoignable
      return serverError(request, new Error("Service de paiement temporairement indisponible."));
    }

    // 5. Mettre à jour la base de données (Exécuté UNIQUEMENT si les transferts ont réussi)
    const result = await env.DB.prepare(
      `SELECT achats FROM paniers WHERE userId = ?`
    ).bind(user.uid).first();
    
    const achats = result?.achats ? JSON.parse(result.achats) : {};
    
    achats[docId] = {
      purchaseDate: (new Date()).toISOString(),
      expiresAt: addMonths(CONFIG.ACCESS_DURATION_MONTHS),
      paymentMethod: "redistribution"
    };
    
    await env.DB.prepare(
      `INSERT INTO paniers (userId, achats) VALUES (?, ?)
       ON CONFLICT(userId) DO UPDATE SET achats = excluded.achats`
    ).bind(user.uid, JSON.stringify(achats)).run();

    // 6. Succès de la transaction
    return success(request, {
      success: true,
      message: "Paiement et redistribution effectués. Accès accordé pour 9 mois.",
      expiresAt: achats[docId].expiresAt,
      redistribution: {
        prixTotal: price,
        plateforme: partPlateforme,
        auteur: partAuteur
      }
    });

  } catch (error) {
    return serverError(request, error);
  }
}
__name(payAndDistributeHandler, "payAndDistributeHandler");
